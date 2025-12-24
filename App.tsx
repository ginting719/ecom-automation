import React, { useState, useEffect, useRef } from 'react';
import { 
  Download, RefreshCw, CheckCircle2, 
  Trash2, LayoutDashboard, ClipboardList, 
  MapPin, FileSpreadsheet, Zap,
  Database, Link as LinkIcon, FileUp, X, Settings, User, ShieldCheck,
  Info, AlertCircle, Search, ChevronDown, Lock, LogOut, Eye, EyeOff,
  ArrowRightLeft
} from 'lucide-react';
import { ProcessStatus, Product, ProcessedProduct, ViewType, HistoryEntry, LogEntry, MasterData, Role } from './types';
import * as XLSX from 'xlsx';

interface ColumnIndices {
  skuPenjual: number;
  idSku: number;
  hargaRitel: number;
  kuantitas: number;
}

const App: React.FC = () => {
  // Hardcoded default URL from user
  const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbxE0ZZJ4oJKUDUD6tkWeiGPZmcBCkuwhP_dZTq9r3entuTDibYEXAH-HqnGlkcINo5ozA/exec';
  
  // Auth States
  const ADMIN_ID = 'apotekalpro';
  const ADMIN_PASS = 'Ecommerce1';
  
  const [role, setRole] = useState<Role>(() => (localStorage.getItem('user_role') as Role) || 'user');
  const [isLoggedIn, setIsLoggedIn] = useState(() => localStorage.getItem('is_admin_logged_in') === 'true');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [activeView, setActiveView] = useState<ViewType>('generator');
  const [appsScriptUrl, setAppsScriptUrl] = useState(() => localStorage.getItem('apps_script_url') || DEFAULT_URL);
  
  const [status, setStatus] = useState<ProcessStatus>(ProcessStatus.IDLE);
  const [fullMasterData, setFullMasterData] = useState<MasterData[]>([]);
  const [availableStores, setAvailableStores] = useState<string[]>([]);
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string>('');
  
  // States for searchable dropdown
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [tokopediaProducts, setTokopediaProducts] = useState<Product[]>([]);
  const [currentWorkbook, setCurrentWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [processedData, setProcessedData] = useState<ProcessedProduct[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentFileName, setCurrentFileName] = useState('');
  const [detectedColumns, setDetectedColumns] = useState<ColumnIndices | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync log/history ke cloud
  const syncToCloud = async (type: 'History' | 'Logs', payload: any[]) => {
    if (!appsScriptUrl) return;
    try {
      await fetch(appsScriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payload })
      });
    } catch (e) { console.error("Cloud sync failed", e); }
  };

  // Ambil data master otomatis dari Apps Script
  const fetchMasterData = async () => {
    if (!appsScriptUrl) return;
    setIsProcessing(true);
    addLog("Menghubungkan ke Database Master...");
    try {
      const resp = await fetch(`${appsScriptUrl}?type=MasterData`);
      const data = await resp.json();
      if (data && Array.isArray(data)) {
        setFullMasterData(data);
        const stores = Array.from(new Set(data.map((m: any) => m.storeName))).filter(s => s).sort();
        setAvailableStores(stores as string[]);
        addLog(`Database Terhubung: ${data.length} item ditemukan.`, 'success');
        setStatus(ProcessStatus.READY_TO_PROCESS);
      }
    } catch (e) {
      addLog("Gagal memuat data master. Pastikan URL Apps Script benar.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const fetchLogsAndHistory = async () => {
    if (!appsScriptUrl) return;
    try {
      const [hResp, lResp] = await Promise.all([
        fetch(`${appsScriptUrl}?type=History`),
        fetch(`${appsScriptUrl}?type=Logs`)
      ]);
      const hData = await hResp.json();
      const lData = await lResp.json();
      setHistory(Array.isArray(hData) ? [...hData].reverse() : []);
      setLogs(Array.isArray(lData) ? [...lData].reverse() : []);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    localStorage.setItem('user_role', role);
    localStorage.setItem('apps_script_url', appsScriptUrl);
    localStorage.setItem('is_admin_logged_in', isLoggedIn.toString());
    
    if (appsScriptUrl) {
      fetchMasterData();
      if (role === 'admin' && isLoggedIn) fetchLogsAndHistory();
    }
  }, [role, isLoggedIn, appsScriptUrl]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const id = Date.now().toString();
    const newLog: LogEntry = { id, timestamp, message, type };
    setLogs(prev => [newLog, ...prev].slice(0, 100));
    syncToCloud('Logs', [id, timestamp, type, message]);
  };

  const findHeaderIndices = (rows: any[][]): { rowIndex: number, indices: ColumnIndices } | null => {
    // Search first 15 rows for the header containing "SKU Penjual"
    for (let r = 0; r < 15; r++) {
      const row = rows[r];
      if (!row) continue;
      
      const skuPenjualIdx = row.findIndex((cell: any) => String(cell).toLowerCase().includes('sku penjual'));
      
      if (skuPenjualIdx !== -1) {
        // We found the header row! Now map the others.
        const idSkuIdx = row.findIndex((cell: any) => String(cell).toLowerCase().includes('id sku'));
        const hargaRitelIdx = row.findIndex((cell: any) => String(cell).toLowerCase().includes('harga ritel'));
        
        // Stock column can be tricky.
        // 1. Look for specific store name in header (TikTok multi-warehouse)
        let kuantitasIdx = -1;
        if (selectedStoreFilter) {
          kuantitasIdx = row.findIndex((cell: any) => String(cell).toLowerCase().includes(selectedStoreFilter.toLowerCase()));
        }
        
        // 2. Fallback to generic stock headers if store specific not found
        if (kuantitasIdx === -1) {
          kuantitasIdx = row.findIndex((cell: any) => 
            String(cell).toLowerCase().includes('kuantitas') || 
            String(cell).toLowerCase().includes('jumlah stok') ||
            String(cell).toLowerCase().includes('jumlah di shop location')
          );
        }

        // Final sanity check for indices
        return {
          rowIndex: r,
          indices: {
            skuPenjual: skuPenjualIdx,
            idSku: idSkuIdx !== -1 ? idSkuIdx : 3, // Fallback to 3 if not found
            hargaRitel: hargaRitelIdx !== -1 ? hargaRitelIdx : 5, // Fallback to 5
            kuantitas: kuantitasIdx !== -1 ? kuantitasIdx : 6 // Fallback to 6
          }
        };
      }
    }
    return null;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCurrentFileName(file.name);
    addLog(`Membaca Template: ${file.name}`);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result as ArrayBuffer;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
        
        const headerInfo = findHeaderIndices(rows);
        if (!headerInfo) { 
          addLog("Gagal mendeteksi kolom 'SKU Penjual'. Pastikan template benar.", "error"); 
          return; 
        }

        const { rowIndex, indices } = headerInfo;
        setDetectedColumns(indices);
        addLog(`Kolom ditemukan: SKU (Kolom ${indices.skuPenjual + 1}), Harga (Kolom ${indices.hargaRitel + 1}), Stok (Kolom ${indices.kuantitas + 1})`, "info");

        const products: Product[] = rows.slice(rowIndex + 2).map((v, index) => ({
          id_produk: String(v[0] || ''),
          kategori: String(v[1] || ''),
          nama_produk: String(v[2] || ''),
          id_sku: String(v[indices.idSku] || ''), 
          nilai_variasi: String(v[4] || ''),
          harga_ritel: parseFloat(v[indices.hargaRitel]) || 0, 
          kuantitas: parseFloat(v[indices.kuantitas]) || 0, 
          sku_penjual: String(v[indices.skuPenjual] || ''), 
          min_order: String(v[9] || ''),
          original_row: v,
          rowRef: index + rowIndex + 2
        }));

        setCurrentWorkbook(workbook);
        setTokopediaProducts(products);
        addLog(`${products.length} produk dari template siap diproses.`, 'info');
      } catch (err) { 
        addLog("Gagal membaca file Excel.", "error"); 
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const runProcess = async () => {
    if (!selectedStoreFilter || !tokopediaProducts.length || !detectedColumns) return;
    setIsProcessing(true);
    setStatus(ProcessStatus.PROCESSING);
    addLog(`Sinkronisasi Stok untuk Toko: ${selectedStoreFilter} (75% Rule Applied)...`);

    const filteredMaster = fullMasterData.filter(m => m.storeName === selectedStoreFilter);
    const masterLookup = new Map<string, MasterData>();
    
    filteredMaster.forEach(m => {
      if (m.sku) {
        masterLookup.set(m.sku.toString().toLowerCase().trim(), m);
      }
    });

    let matches = 0;
    const result: ProcessedProduct[] = tokopediaProducts.map(p => {
      const sku1 = p.id_sku?.toString().toLowerCase().trim();
      const sku2 = p.sku_penjual?.toString().toLowerCase().trim();
      const master = masterLookup.get(sku1) || masterLookup.get(sku2);
      
      if (master) {
        matches++;
        // Automation Rule: 75% of master stock
        const safetyStock = Math.floor(master.stok * 0.75);
        return { 
          ...p, 
          updated_price: master.harga > 0 ? master.harga : p.harga_ritel, 
          updated_stock: safetyStock, 
          master_stock: master.stok,
          is_matched: true 
        };
      }
      return { 
        ...p, 
        updated_price: p.harga_ritel, 
        updated_stock: p.kuantitas, 
        master_stock: p.kuantitas,
        is_matched: false 
      };
    });

    setProcessedData(result);
    const histId = Date.now().toString();
    const histTime = new Date().toLocaleString('id-ID');
    
    if (role === 'admin') {
      const newEntry: HistoryEntry = { 
        id: histId, 
        timestamp: histTime, 
        file: currentFileName, 
        store: selectedStoreFilter, 
        skucount: result.length, 
        matchcount: matches 
      };
      setHistory(prev => [newEntry, ...prev]);
    }
    
    syncToCloud('History', [histId, histTime, selectedStoreFilter, currentFileName, result.length, matches]);
    
    setIsProcessing(false);
    setStatus(ProcessStatus.COMPLETED);
    addLog(`Selesai! ${matches} dari ${result.length} produk berhasil diupdate dengan skema 75% stok.`, 'success');
  };

  const downloadFile = () => {
    if (!currentWorkbook || !detectedColumns) return;
    const workbook = { ...currentWorkbook };
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    
    processedData.forEach(p => {
      if (p.is_matched) {
        const priceCell = XLSX.utils.encode_cell({ r: p.rowRef, c: detectedColumns.hargaRitel });
        sheet[priceCell] = { v: Math.round(p.updated_price), t: 'n' };
        const qtyCell = XLSX.utils.encode_cell({ r: p.rowRef, c: detectedColumns.kuantitas });
        sheet[qtyCell] = { v: Math.round(p.updated_stock), t: 'n' };
      }
    });

    const excelBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `UPDATE_${selectedStoreFilter}_${currentFileName}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addLog("Hasil update berhasil diunduh.", "success");
  };

  const reset = () => {
    setTokopediaProducts([]);
    setProcessedData([]);
    setCurrentFileName('');
    setDetectedColumns(null);
    setStatus(ProcessStatus.READY_TO_PROCESS);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginId === ADMIN_ID && loginPass === ADMIN_PASS) {
      setIsLoggedIn(true);
      setRole('admin');
      setShowLoginModal(false);
      setLoginError('');
      setLoginId('');
      setLoginPass('');
      addLog("Admin Login Berhasil", "success");
    } else {
      setLoginError("ID atau Password salah.");
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setRole('user');
    setActiveView('generator');
    addLog("Admin Logout", "info");
  };

  const filteredStoresList = availableStores.filter(store => 
    store.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="h-screen bg-[#f8fafc] flex flex-col md:flex-row antialiased text-slate-900 overflow-hidden font-sans">
      
      {/* Sidebar - Compact Width */}
      {role === 'admin' && isLoggedIn && (
        <aside className="w-full md:w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 z-20 shadow-xl overflow-y-auto">
          <div className="p-8 flex items-center space-x-4">
            <div className="flex items-center justify-center shrink-0">
              <img 
                src="https://cdn.jsdelivr.net/gh/ginting719/Audio/LOGO-01.png" 
                alt="Logo" 
                className="w-14 h-14 object-contain"
              />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-black text-slate-800 tracking-tight italic uppercase leading-none pr-4">ECOMMERCE</h2>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 whitespace-pre-line leading-tight">Apotek Alpro Indonesia</p>
            </div>
          </div>
          <nav className="flex-1 px-5 space-y-1.5">
            {[
              { id: 'generator', icon: Zap, label: 'Automation' },
              { id: 'dashboard', icon: LayoutDashboard, label: 'History' },
              { id: 'logs', icon: ClipboardList, label: 'Logs' },
              { id: 'settings', icon: Settings, label: 'API Endpoint' }
            ].map(item => (
              <button key={item.id} onClick={() => setActiveView(item.id as ViewType)} 
                className={`w-full flex items-center space-x-3.5 px-5 py-4 rounded-xl font-bold text-sm transition-all ${activeView === item.id ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'text-slate-500 hover:bg-slate-50'}`}>
                <item.icon className="w-4 h-4" /><span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="p-6">
            <button onClick={handleLogout} className="w-full py-3 bg-slate-50 hover:bg-rose-50 rounded-xl text-[9px] font-black text-slate-400 hover:text-rose-600 transition-all flex items-center justify-center space-x-2">
              <LogOut className="w-3.5 h-3.5" /> <span>Logout Admin</span>
            </button>
          </div>
        </aside>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative bg-[#f8fafc]">
        {/* Portal Access Button */}
        {role === 'user' && (
          <div className="fixed bottom-6 right-6 z-40">
             <button 
               onClick={() => setShowLoginModal(true)} 
               className="p-2.5 bg-white border border-slate-200 rounded-xl shadow-md text-slate-400 hover:text-indigo-600 transition-all flex items-center space-x-2.5 group active:scale-95"
             >
               <Lock className="w-3.5 h-3.5" />
               <span className="text-[9px] font-black uppercase tracking-widest hidden group-hover:block transition-all">Portal Admin</span>
             </button>
          </div>
        )}

        <div className={`max-w-[1100px] mx-auto px-6 py-10 ${role === 'user' ? 'pt-16' : ''}`}>
          {activeView === 'generator' && (
            <div className="space-y-10 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <header className="text-center mb-12">
                {/* Logo Row - Hidden in Admin View per request */}
                {role !== 'admin' && (
                  <div className="flex items-center justify-center mb-12 space-x-12">
                    <img 
                      src="https://cdn.jsdelivr.net/gh/ginting719/Audio/LOGO-01.png" 
                      alt="Alpro" 
                      className="h-24 md:h-28 w-auto object-contain"
                    />
                    
                    <div className="flex flex-col items-center justify-center group relative px-4">
                      <div className="relative">
                        <div className="absolute inset-0 bg-indigo-500/10 blur-xl rounded-full scale-125 animate-pulse"></div>
                        <ArrowRightLeft className="w-12 h-12 md:w-16 md:h-16 text-indigo-600 animate-sync-slide relative z-10" />
                      </div>
                      <span className="text-[8px] md:text-[9px] font-black text-indigo-500 tracking-[0.5em] uppercase mt-4 whitespace-nowrap opacity-70 animate-pulse">SYNCHRONIZING</span>
                    </div>

                    <div className="flex items-center space-x-8 md:space-x-12">
                      <img 
                        src="https://static.vecteezy.com/system/resources/previews/054/650/845/non_2x/tokopedia-logo-free-tokopedia-logo-download-free-png.png" 
                        alt="Tokopedia" 
                        className="h-20 md:h-24 w-auto object-contain"
                      />
                      <img 
                        src="https://upload.wikimedia.org/wikipedia/en/a/a9/TikTok_logo.svg" 
                        alt="TikTok" 
                        className="h-14 md:h-16 w-auto object-contain"
                      />
                    </div>
                  </div>
                )}

                <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2.5">Stock Sync <span className="text-indigo-600">Automation</span></h1>
                <p className="text-slate-500 text-sm font-medium leading-relaxed max-w-xl mx-auto">
                  Update stok produk marketplace secara otomatis dari database pusat Alpro secara instan dengan algoritma safety buffer 75%.
                </p>
                
                {availableStores.length === 0 && !isProcessing && (
                  <div className="mt-6 inline-flex items-center px-4 py-2.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-xs font-bold animate-pulse">
                    <AlertCircle className="w-4 h-4 mr-2" /> Database belum terhubung. Periksa URL API di pengaturan.
                  </div>
                )}
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Inputs Section */}
                <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm space-y-8">
                  <div ref={dropdownRef}>
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="bg-indigo-600 text-white w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm">1</div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Pilih Nama Apotek</label>
                    </div>
                    
                    <div className="relative">
                      <div 
                        className="w-full bg-slate-50 border-2 border-transparent focus-within:border-indigo-500 focus-within:bg-white rounded-xl flex items-center transition-all shadow-inner overflow-hidden cursor-text"
                        onClick={() => setIsDropdownOpen(true)}
                      >
                        <div className="pl-5 text-slate-400"><Search className="w-4 h-4" /></div>
                        <input 
                          type="text"
                          placeholder="Cari apotek..."
                          value={isDropdownOpen ? searchTerm : (selectedStoreFilter || searchTerm)}
                          onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setIsDropdownOpen(true);
                          }}
                          onFocus={() => setIsDropdownOpen(true)}
                          className="flex-1 bg-transparent py-4 px-3 outline-none font-bold text-base text-slate-800 placeholder:text-slate-300"
                        />
                        <div className="pr-5 text-slate-300">
                          <ChevronDown className={`w-5 h-5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                        </div>
                      </div>

                      {isDropdownOpen && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 p-1.5">
                          {filteredStoresList.length > 0 ? (
                            filteredStoresList.map((store, idx) => (
                              <button
                                key={idx}
                                onClick={() => {
                                  setSelectedStoreFilter(store);
                                  setSearchTerm(store);
                                  setIsDropdownOpen(false);
                                }}
                                className={`w-full text-left px-6 py-3 text-sm font-bold transition-all rounded-lg mb-0.5 last:mb-0 hover:bg-indigo-50 hover:text-indigo-600 ${selectedStoreFilter === store ? 'bg-indigo-600 text-white shadow shadow-indigo-100' : 'text-slate-600'}`}
                              >
                                {store}
                              </button>
                            ))
                          ) : (
                            <div className="p-8 text-center text-slate-400 text-xs italic font-medium">Apotek tidak ditemukan.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-8 border-t border-slate-100">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="bg-indigo-600 text-white w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm">2</div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Upload Template Excel</label>
                    </div>
                    {tokopediaProducts.length === 0 ? (
                      <div 
                        onClick={() => fileInputRef.current?.click()} 
                        className="border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 transition-all group shadow-inner"
                      >
                         <div className="bg-slate-100 group-hover:bg-indigo-100 p-4 rounded-xl mb-3 transition-all">
                           <FileUp className="w-8 h-8 text-slate-300 group-hover:text-indigo-600 transition-transform group-hover:-translate-y-1.5" />
                         </div>
                         <span className="text-sm font-bold text-slate-400 group-hover:text-indigo-600">Klik untuk pilih file XLSX</span>
                         <input type="file" ref={fileInputRef} accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
                      </div>
                    ) : (
                      <div className="bg-slate-900 p-6 rounded-2xl flex items-center justify-between text-white shadow-xl shadow-slate-100">
                         <div className="flex items-center space-x-4 overflow-hidden">
                           <div className="bg-indigo-500/20 p-3 rounded-xl"><FileSpreadsheet className="w-7 h-7 text-emerald-400" /></div>
                           <div className="truncate">
                             <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-0.5">File Terpilih</p>
                             <p className="truncate font-black text-lg tracking-tight leading-none">{currentFileName}</p>
                           </div>
                         </div>
                         <button onClick={reset} className="p-3.5 bg-white/5 hover:bg-rose-500 rounded-xl transition-all"><Trash2 className="w-5 h-5" /></button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Confirm Section */}
                <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div className="space-y-8">
                    <div className="flex items-center space-x-3 mb-1">
                      <div className="bg-indigo-600 text-white w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm">3</div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Konfirmasi & Aturan</label>
                    </div>
                    
                    <div className="bg-slate-50 p-6 rounded-2xl space-y-4 border border-slate-100 shadow-inner">
                      <div className="flex justify-between items-center border-b border-slate-200/50 pb-4">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Apotek Sasaran</span>
                        <span className="font-black text-slate-900 text-sm truncate ml-4 text-right">{selectedStoreFilter || '-'}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-200/50 pb-4">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total SKU</span>
                        <span className="font-black text-slate-900 text-xl tabular-nums">{tokopediaProducts.length} <span className="text-[10px] text-slate-400">ITEM</span></span>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-200/50 pb-4">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Skema Safety Buffer</span>
                        <div className="flex items-center space-x-2">
                           <Zap className="w-3.5 h-3.5 text-indigo-600 fill-indigo-600" />
                           <span className="font-black text-slate-900 text-sm">75% MULTIPLIER</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Database</span>
                        <div className="flex items-center bg-white px-3 py-1.5 rounded-full border border-slate-100 shadow-sm">
                          <div className={`w-2 h-2 rounded-full mr-2.5 ${fullMasterData.length ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}></div>
                          <span className={`font-black text-[9px] tracking-widest ${fullMasterData.length ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {fullMasterData.length ? 'ONLINE' : 'OFFLINE'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-10">
                    {status !== ProcessStatus.COMPLETED ? (
                      <button 
                        onClick={runProcess} 
                        disabled={isProcessing || !selectedStoreFilter || !tokopediaProducts.length} 
                        className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black text-xl hover:bg-indigo-700 disabled:opacity-20 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center group active:scale-95"
                      >
                        {isProcessing ? (
                          <RefreshCw className="w-6 h-6 animate-spin" />
                        ) : (
                          <>
                            <span>UPDATE SEKARANG</span>
                            <Zap className="w-6 h-6 ml-3.5 fill-white group-hover:scale-110 transition-all" />
                          </>
                        )}
                      </button>
                    ) : (
                      <div className="space-y-4 animate-in slide-in-from-top-3">
                        <button 
                          onClick={downloadFile} 
                          className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-black text-xl hover:bg-emerald-700 flex items-center justify-center animate-bounce-short shadow-lg shadow-emerald-100"
                        >
                          <Download className="w-6 h-6 mr-4" /> DOWNLOAD HASIL
                        </button>
                        <button onClick={reset} className="w-full py-3 text-slate-400 font-black text-[9px] hover:text-indigo-600 transition-colors uppercase tracking-[0.2em]">Reset Sesi</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats - Compact Display */}
              {status === ProcessStatus.COMPLETED && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 animate-in slide-in-from-bottom-5 duration-500">
                   <div className="bg-emerald-50 border border-emerald-100 p-8 rounded-[32px] flex items-center justify-between shadow-sm relative overflow-hidden group">
                      <div className="relative z-10">
                        <p className="text-[9px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-3">Update Berhasil</p>
                        <div className="text-5xl font-black text-emerald-800 leading-none tracking-tight">{processedData.filter(p => p.is_matched).length}</div>
                        <p className="text-sm text-emerald-700/70 mt-3 font-bold max-w-xs">Produk ditemukan & diperbarui dengan safety stock 75%.</p>
                      </div>
                      <div className="bg-white p-6 rounded-2xl shadow-xl shadow-emerald-200/50 relative z-10">
                        <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                      </div>
                   </div>
                   <div className="bg-slate-100 border border-slate-200 p-8 rounded-[32px] flex items-center justify-between relative overflow-hidden group">
                      <div className="relative z-10">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-3">No Match</p>
                        <div className="text-5xl font-black text-slate-700 leading-none tracking-tight">{processedData.filter(p => !p.is_matched).length}</div>
                        <p className="text-sm text-slate-400 mt-3 font-bold max-w-xs">SKU tidak terdaftar di database apotek sasaran.</p>
                      </div>
                      <div className="bg-white p-6 rounded-2xl shadow-xl shadow-slate-200/50 relative z-10">
                        <X className="w-10 h-10 text-slate-400" />
                      </div>
                   </div>
                </div>
              )}
            </div>
          )}

          {/* Admin Views */}
          {activeView === 'dashboard' && role === 'admin' && isLoggedIn && (
             <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-400">
                <header className="flex justify-between items-end bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                  <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-1.5">Process <span className="text-indigo-600">History</span></h1>
                    <p className="text-slate-500 font-bold text-sm">Riwayat pembaruan stok yang telah dilakukan oleh sistem.</p>
                  </div>
                  <button onClick={fetchLogsAndHistory} className="p-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 shadow-sm transition-all group active:scale-90">
                    <RefreshCw className="w-5 h-5 text-indigo-600 group-hover:rotate-180 transition-transform duration-700" />
                  </button>
                </header>
                
                <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                   <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em]">
                          <th className="px-8 py-5">Timestamp</th>
                          <th className="px-8 py-5">Store</th>
                          <th className="px-8 py-5">File Source</th>
                          <th className="px-8 py-5 text-right">Updated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                         {history.length === 0 ? (
                           <tr><td colSpan={4} className="px-8 py-16 text-center text-slate-300 font-black text-base italic uppercase tracking-widest opacity-50">Belum ada riwayat proses</td></tr>
                         ) : (
                           history.map((h, i) => (
                              <tr key={i} className="hover:bg-indigo-50/30 transition-all group">
                                 <td className="px-8 py-5 text-[11px] text-slate-500 font-bold">{h.timestamp}</td>
                                 <td className="px-8 py-5 font-black text-slate-900 text-base uppercase tracking-tight group-hover:text-indigo-600">{h.store || (h as any).storename || '-'}</td>
                                 <td className="px-8 py-5 text-xs font-bold text-slate-700 italic max-w-[250px] truncate">{h.file || (h as any).filename || '-'}</td>
                                 <td className="px-8 py-5 text-right">
                                   <div className="inline-flex flex-col items-end">
                                      <span className="font-black text-emerald-600 text-lg tabular-nums tracking-tighter">{h.matchcount} <span className="text-[9px] text-slate-300">/ {h.skucount} SKU</span></span>
                                   </div>
                                 </td>
                              </tr>
                           ))
                         )}
                      </tbody>
                   </table>
                </div>
             </div>
          )}

          {activeView === 'logs' && role === 'admin' && isLoggedIn && (
             <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-400">
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">System <span className="text-indigo-600">Logs</span></h1>
                <div className="bg-slate-900 rounded-[32px] p-8 font-mono text-xs leading-relaxed shadow-xl border border-slate-800 min-h-[400px]">
                   <div className="flex items-center space-x-2.5 mb-6 border-b border-white/10 pb-5">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                      <span className="text-slate-500 font-black ml-3 uppercase tracking-widest text-[9px]">Console Output v3.1</span>
                   </div>
                   <div className="space-y-3">
                     {logs.map((l, i) => (
                        <div key={i} className="flex space-x-6 border-b border-white/5 pb-3 last:border-0 hover:bg-white/5 transition-all p-1.5 rounded-lg">
                           <span className="text-slate-500 shrink-0 font-bold">{l.timestamp}</span>
                           <span className={`font-black w-20 shrink-0 tracking-tighter text-center rounded-md text-[9px] py-0.5 ${l.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : l.type === 'error' ? 'bg-rose-500/10 text-rose-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                             {l.type.toUpperCase()}
                           </span>
                           <span className="text-slate-200 font-bold tracking-tight italic">{l.message}</span>
                        </div>
                     ))}
                   </div>
                </div>
             </div>
          )}

          {activeView === 'settings' && role === 'admin' && isLoggedIn && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-400">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">API <span className="text-indigo-600">Endpoint</span></h1>
              <div className="bg-white rounded-3xl p-8 border border-slate-200 space-y-8 shadow-sm max-w-3xl">
                <div className="space-y-4">
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-3">API Token</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="https://script.google.com/..." 
                      value={appsScriptUrl} 
                      onChange={(e) => setAppsScriptUrl(e.target.value)}
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl py-5 px-6 outline-none focus:border-indigo-500 focus:bg-white transition-all font-mono text-[10px] shadow-inner"
                    />
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 bg-white p-2.5 rounded-lg border border-slate-100">
                      <LinkIcon className="text-indigo-600 w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-[9px] text-slate-400 font-bold ml-3 italic">* Endpoint ini untuk menghubungkan system dengan database Alpro</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/70 backdrop-blur-lg animate-in fade-in duration-400">
          <div className="bg-white rounded-[40px] w-full max-w-md p-10 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setShowLoginModal(false)}
              className="absolute top-8 right-8 p-3 text-slate-300 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="mb-10 flex flex-col items-center text-center">
               <div className="bg-indigo-600 p-4 rounded-2xl shadow-xl shadow-indigo-100 mb-6">
                 <Lock className="w-7 h-7 text-white" />
               </div>
               <h2 className="text-2xl font-black text-slate-900 tracking-tight">Otorisasi Admin</h2>
               <p className="text-slate-500 font-medium text-sm mt-2">Silakan masuk untuk akses kontrol penuh.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
               <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-3">ID Administrator</label>
                  <input 
                    type="text" 
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    placeholder="Username..."
                    className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl py-4 px-6 outline-none font-bold text-lg text-slate-800 transition-all shadow-inner"
                    required
                  />
               </div>

               <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-3">Kata Sandi</label>
                  <div className="relative">
                    <input 
                      type={showPass ? "text" : "password"} 
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl py-4 px-6 outline-none font-bold text-lg text-slate-800 transition-all shadow-inner pr-16"
                      required
                    />
                    <button 
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-all"
                    >
                      {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
               </div>

               {loginError && (
                 <div className="bg-rose-50 border border-rose-100 p-4 rounded-xl flex items-center space-x-3 text-rose-600 text-xs font-bold animate-shake">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{loginError}</span>
                 </div>
               )}

               <button 
                type="submit" 
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-xl hover:bg-slate-800 transition-all shadow shadow-slate-200 active:scale-95"
               >
                 Masuk Dashboard
               </button>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounce-short {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          75% { transform: translateX(6px); }
        }
        @keyframes sync-slide {
          0%, 100% { transform: translateX(-10px); opacity: 0.4; }
          50% { transform: translateX(10px); opacity: 1; }
        }
        .animate-sync-slide { animation: sync-slide 2.2s infinite ease-in-out; }
        .animate-bounce-short { animation: bounce-short 3s infinite ease-in-out; }
        .animate-shake { animation: shake 0.3s ease-in-out; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; border: 2px solid #f8fafc; }
        ::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
        ::selection { background: #6366f1; color: white; }
      `}</style>
    </div>
  );
};

export default App;