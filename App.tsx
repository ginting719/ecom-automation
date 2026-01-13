
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Download, RefreshCw, CheckCircle2, 
  Trash2, LayoutDashboard, ClipboardList, 
  FileSpreadsheet, Zap,
  FileUp, X, Settings, Lock, LogOut, Search, ChevronDown, ArrowRightLeft, Calendar, Filter
} from 'lucide-react';
import { ProcessStatus, Product, ProcessedProduct, ViewType, HistoryEntry, LogEntry, MasterData, Role } from './types';
import * as XLSX from 'xlsx';

interface ColumnIndices {
  skuPenjual: number;
  idSku: number;
  hargaRitel: number;
  stokCols: number[];
  namaProduk: number;
  templateType: 'Reguler' | 'MWH';
}

const App: React.FC = () => {
  const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycby_8QjMtjafWHJ4LQhanS6aliAwPZA9v3q1Dnb9h33TMc0CKlBaMpk4qeKZkBfClietug/exec';
  const ADMIN_ID = 'apotekalpro';
  const ADMIN_PASS = 'Ecommerce1';
  
  const [role, setRole] = useState<Role>(() => (localStorage.getItem('user_role') as Role) || 'user');
  const [isLoggedIn, setIsLoggedIn] = useState(() => localStorage.getItem('is_admin_logged_in') === 'true');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeView, setActiveView] = useState<ViewType>('generator');
  const [appsScriptUrl, setAppsScriptUrl] = useState(() => localStorage.getItem('apps_script_url') || DEFAULT_URL);
  
  const [status, setStatus] = useState<ProcessStatus>(ProcessStatus.IDLE);
  const [fullMasterData, setFullMasterData] = useState<MasterData[]>([]);
  const [availableStores, setAvailableStores] = useState<string[]>([]);
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string>('');
  
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

  // Filter States
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [logSearchQuery, setLogSearchQuery] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parser tanggal yang sangat toleran untuk format "13/01/2026, 17.53.02"
  const parseSheetDate = (dateStr: any): Date | null => {
    if (!dateStr) return null;
    const s = String(dateStr).trim();
    if (!s || s.toLowerCase() === 'timestamp') return null;

    // Ambil bagian sebelum koma (13/01/2026)
    const dateOnly = s.split(',')[0].trim();
    const parts = dateOnly.split(/[/.-]/);
    
    if (parts.length === 3) {
      let day, month, year;
      // YYYY-MM-DD vs DD-MM-YYYY
      if (parts[0].length === 4) {
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        day = parseInt(parts[2], 10);
      } else {
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        year = parseInt(parts[2], 10);
      }
      
      const dateObj = new Date(year, month, day);
      dateObj.setHours(0, 0, 0, 0); // Normalize jam ke 00:00 agar perbandingan akurat
      return isNaN(dateObj.getTime()) ? null : dateObj;
    }
    
    const fallback = new Date(s);
    if (!isNaN(fallback.getTime())) {
      fallback.setHours(0, 0, 0, 0);
      return fallback;
    }
    return null;
  };

  const parseIndoNumber = (val: any): number => {
    if (typeof val === 'number') return val;
    let s = String(val || '0').trim();
    if (!s || s === '0' || s === '-') return 0;
    s = s.replace(/Rp|IDR|\s/gi, '');
    if (s.includes(',') && s.includes('.')) {
      const lastComma = s.lastIndexOf(',');
      const lastDot = s.lastIndexOf('.');
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(/,/g, '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      if (/,(\d{3})($|[^\d])/.test(s)) s = s.replace(/,/g, '');
      else s = s.replace(/,/g, '.');
    } else if (s.includes('.')) {
      if (/\.(\d{3})($|[^\d])/.test(s)) s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const fetchMasterData = useCallback(async () => {
    if (!appsScriptUrl) return;
    setIsProcessing(true);
    try {
      const resp = await fetch(`${appsScriptUrl}?type=MasterData`);
      const rawData = await resp.json();
      
      if (rawData && Array.isArray(rawData)) {
        const normalizedData: MasterData[] = rawData.map((item: any) => ({
          sku: String(item.sku || '').trim().toLowerCase(),
          harga: Number(item.harga) || 0,
          stok: Number(item.stok) || 0,
          storeName: String(item.storeName || '').trim(),
          storeCode: "" 
        }));

        setFullMasterData(normalizedData);
        const stores = Array.from(new Set(normalizedData.map(m => m.storeName))).filter(s => s).sort();
        setAvailableStores(stores as string[]);
        setStatus(ProcessStatus.READY_TO_PROCESS);
      }
    } catch (e) {
      console.error("Gagal menarik data master");
    } finally {
      setIsProcessing(false);
    }
  }, [appsScriptUrl]);

  const fetchHistory = useCallback(async () => {
    if (!appsScriptUrl || role !== 'admin' || !isLoggedIn) return;
    try {
      const resp = await fetch(`${appsScriptUrl}?type=History`);
      const d = await resp.json();
      if (Array.isArray(d)) {
        // Apps Script Anda mengirimkan OBJEK (HistoryEntry mapping)
        const formattedHistory: HistoryEntry[] = d.map((h: any) => ({
          id: String(h.id || ''),
          timestamp: String(h.timestamp || ''),
          store: String(h.store || ''),
          file: String(h.file || ''),
          skucount: Number(h.skucount) || 0,
          matchcount: Number(h.matchcount) || 0
        })).reverse();
        setHistory(formattedHistory);
      }
    } catch (e) {
      console.error("Gagal menarik data history:", e);
    }
  }, [appsScriptUrl, role, isLoggedIn]);

  const fetchLogs = useCallback(async () => {
    if (!appsScriptUrl || role !== 'admin' || !isLoggedIn) return;
    try {
      const resp = await fetch(`${appsScriptUrl}?type=Logs`);
      const d = await resp.json();
      if (Array.isArray(d)) {
        const formattedLogs: LogEntry[] = d.map((l: any) => ({
          id: String(l.id || ''),
          timestamp: String(l.timestamp || ''),
          type: (l.type || 'info') as any,
          message: String(l.message || '')
        })).reverse();
        setLogs(formattedLogs);
      }
    } catch (e) {
      console.error("Gagal menarik data logs:", e);
    }
  }, [appsScriptUrl, role, isLoggedIn]);

  const syncToCloud = async (type: 'History' | 'Logs', payload: any[]) => {
    if (!appsScriptUrl) return;
    try {
      await fetch(appsScriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payload })
      });
    } catch (e) { console.error(e); }
  };

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleString('id-ID', { hour12: false });
    const id = Date.now().toString();
    setLogs(prev => [{ id, timestamp, message, type }, ...prev].slice(0, 100));
    syncToCloud('Logs', [id, timestamp, type, message]);
  };

  const findHeaderIndices = (rows: any[][]): { rowIndex: number, indices: ColumnIndices } | null => {
    for (let r = 0; r < 15; r++) {
      const row = rows[r];
      if (!row) continue;
      
      const skuIdx = row.findIndex(c => {
        const s = String(c || '').toLowerCase();
        return s.includes('sku penju') || s.includes('sku_penjual');
      });

      if (skuIdx !== -1) {
        const hargaIdx = row.findIndex(c => String(c || '').toLowerCase().includes('harga ritel'));
        const stokCols: number[] = [];
        row.forEach((cell, idx) => {
          const s = String(cell || '').toLowerCase();
          if (s.includes('jumlah di') || s.includes('kuantitas')) stokCols.push(idx);
        });

        const namaIdx = row.findIndex(c => String(c || '').toLowerCase().includes('nama produk'));
        const idSkuIdx = row.findIndex(c => String(c || '').toLowerCase().includes('id sku'));

        return {
          rowIndex: r,
          indices: {
            skuPenjual: skuIdx,
            idSku: idSkuIdx !== -1 ? idSkuIdx : 3,
            hargaRitel: hargaIdx !== -1 ? hargaIdx : 5,
            stokCols: stokCols.length > 0 ? stokCols : [6],
            namaProduk: namaIdx !== -1 ? namaIdx : 2,
            templateType: stokCols.length > 1 ? 'MWH' : 'Reguler'
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
    addLog(`Upload file: ${file.name}`, "info");
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result as ArrayBuffer;
        const workbook = XLSX.read(data, { type: 'array' });
        let targetData = null;
        for (const name of workbook.SheetNames) {
          const rows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[name], { header: 1, defval: "" });
          const headerInfo = findHeaderIndices(rows);
          if (headerInfo) { targetData = { rows, headerInfo, sheetName: name }; break; }
        }

        if (!targetData) {
          addLog("Gagal Membaca File: Header 'SKU Penjual' tidak ditemukan.", "error");
          return;
        }

        const { rows, headerInfo } = targetData;
        const { rowIndex, indices } = headerInfo;
        setDetectedColumns(indices);

        const isInstruction = (val: string) => {
          const s = String(val || '').toLowerCase();
          return ['wajib', 'opsional', 'tidak dapat', 'masukkan', 'contoh', 'maksimal', 'fitur'].some(k => s.includes(k));
        };

        const products: Product[] = rows.slice(rowIndex + 1)
          .map((v, idx) => {
            const cleanStr = (val: any) => String(val || '').trim();
            const skuVal = cleanStr(v[indices.skuPenjual]);
            return {
              id_produk: cleanStr(v[0]),
              kategori: cleanStr(v[1]),
              nama_produk: cleanStr(v[indices.namaProduk]),
              id_sku: cleanStr(v[indices.idSku]),
              nilai_variasi: cleanStr(v[indices.idSku + 1]),
              harga_ritel: parseIndoNumber(v[indices.hargaRitel]),
              kuantitas: parseIndoNumber(v[indices.stokCols[0]]),
              sku_penjual: skuVal,
              min_order: cleanStr(v[9]),
              original_row: v,
              rowRef: idx + rowIndex + 1 
            };
          })
          .filter(p => p.sku_penjual && !isInstruction(p.sku_penjual));

        setCurrentWorkbook(workbook);
        setTokopediaProducts(products);
        addLog(`File terbaca: ${products.length} baris data Tokopedia.`, 'success');
      } catch (err) {
        addLog("Error memproses Excel.", "error");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const runProcess = async () => {
    if (!selectedStoreFilter || !tokopediaProducts.length || !detectedColumns) return;
    setIsProcessing(true);
    setStatus(ProcessStatus.PROCESSING);
    addLog(`Memulai Generate untuk cabang: ${selectedStoreFilter}`, "info");

    const masterLookup = new Map<string, MasterData>();
    fullMasterData
      .filter(m => String(m.storeName || '').toLowerCase() === String(selectedStoreFilter || '').toLowerCase())
      .forEach(m => masterLookup.set(m.sku, m));

    let matches = 0;
    const result: ProcessedProduct[] = tokopediaProducts.map(p => {
      const cleanSku = String(p.sku_penjual || '').toLowerCase().trim();
      const master = masterLookup.get(cleanSku);
      
      if (master) {
        matches++;
        const dbPrice = master.harga > 0 ? master.harga : p.harga_ritel;
        const dbStock = Math.floor(master.stok * 0.75);
        
        return { 
          ...p, 
          updated_price: dbPrice, 
          updated_stock: dbStock, 
          is_matched: true 
        };
      }
      return { ...p, updated_price: p.harga_ritel, updated_stock: p.kuantitas, is_matched: false };
    });

    setProcessedData(result);
    setIsProcessing(false);
    setStatus(ProcessStatus.COMPLETED);
    addLog(`Generate Selesai: ${matches} SKU dari ${result.length} cocok dengan database Alpro.`, 'success');
    syncToCloud('History', [Date.now().toString(), new Date().toLocaleString('id-ID', { hour12: false }), selectedStoreFilter, currentFileName, result.length, matches]);
  };

  const downloadFile = () => {
    if (!currentWorkbook || !detectedColumns) return;
    const wb = { ...currentWorkbook };
    addLog(`Mempersiapkan download file hasil...`, "info");
    
    let targetSheetName = "";
    for (const name of wb.SheetNames) {
      if (findHeaderIndices(XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1 }))) {
        targetSheetName = name;
        break;
      }
    }
    
    if (!targetSheetName) return;
    const sheet = wb.Sheets[targetSheetName];
    
    processedData.forEach(p => {
      if (p.is_matched) {
        const pCell = XLSX.utils.encode_cell({ r: p.rowRef, c: detectedColumns.hargaRitel });
        delete sheet[pCell]; 
        sheet[pCell] = { v: Number(p.updated_price), t: 'n' };
        
        detectedColumns.stokCols.forEach(colIdx => {
          const qCell = XLSX.utils.encode_cell({ r: p.rowRef, c: colIdx });
          delete sheet[qCell];
          sheet[qCell] = { v: Number(p.updated_stock), t: 'n' };
        });
      }
    });

    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AUTOMATED_${selectedStoreFilter.replace(/\s+/g, '_')}_${currentFileName}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    addLog("File hasil berhasil diunduh.", "success");
  };

  const reset = () => {
    setTokopediaProducts([]); setProcessedData([]); setCurrentFileName(''); 
    setDetectedColumns(null); setStatus(ProcessStatus.READY_TO_PROCESS);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    if (appsScriptUrl) {
      fetchMasterData();
    }
  }, [appsScriptUrl, fetchMasterData]);

  useEffect(() => {
    if (appsScriptUrl && role === 'admin' && isLoggedIn) {
      if (activeView === 'dashboard') {
        fetchHistory();
      } else if (activeView === 'logs') {
        fetchLogs();
      }
    }
  }, [appsScriptUrl, role, isLoggedIn, activeView, fetchHistory, fetchLogs]);

  const filteredStores = availableStores.filter(s => String(s || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()));

  const filteredHistory = history.filter(h => {
    const entryDate = parseSheetDate(h.timestamp);
    if (!entryDate) return !historyStartDate && !historyEndDate;
    
    const start = historyStartDate ? new Date(historyStartDate) : null;
    const end = historyEndDate ? new Date(historyEndDate) : null;
    
    if (start) {
      start.setHours(0, 0, 0, 0);
      if (entryDate < start) return false;
    }
    if (end) {
      end.setHours(23, 59, 59, 999);
      if (entryDate > end) return false;
    }
    return true;
  });

  const filteredLogs = logs.filter(l => 
    String(l.message || '').toLowerCase().includes(String(logSearchQuery || '').toLowerCase()) || 
    String(l.type || '').toLowerCase().includes(String(logSearchQuery || '').toLowerCase())
  );

  return (
    <div className="h-screen bg-slate-50 flex flex-col md:flex-row antialiased overflow-hidden font-sans">
      {role === 'admin' && isLoggedIn && (
        <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shadow-xl z-30 shrink-0">
          <div className="p-6 flex items-center space-x-3 border-b border-slate-50 mb-4">
            <img src="https://cdn.jsdelivr.net/gh/ginting719/Audio/LOGO-01.png" className="w-12 h-12 object-contain" alt="Alpro Logo" />
            <div className="flex flex-col">
              <h2 className="text-xl font-black text-slate-800 tracking-tight leading-none uppercase">Ecommerce</h2>
              <p className="text-[8px] font-bold text-slate-400 mt-1 uppercase tracking-widest leading-none">Apotek Alpro Indonesia</p>
            </div>
          </div>
          <nav className="flex-1 px-4 space-y-1">
            {[
              { id: 'generator', icon: Zap, label: 'Automation' },
              { id: 'dashboard', icon: LayoutDashboard, label: 'History' },
              { id: 'logs', icon: ClipboardList, label: 'Logs' },
              { id: 'settings', icon: Settings, label: 'Config' }
            ].map(item => (
              <button key={item.id} onClick={() => setActiveView(item.id as any)} 
                className={`w-full flex items-center space-x-3 px-5 py-4 rounded-xl font-bold text-sm transition-all ${activeView === item.id ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}>
                <item.icon className="w-4 h-4" /><span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="p-6">
            <button onClick={() => { setIsLoggedIn(false); setRole('user'); localStorage.removeItem('is_admin_logged_in'); }} className="w-full py-3 bg-slate-50 rounded-xl text-[9px] font-black text-slate-400 hover:text-rose-600 flex items-center justify-center space-x-2 transition-colors">
              <LogOut className="w-3.5 h-3.5" /> <span>Logout Admin</span>
            </button>
          </div>
        </aside>
      )}

      <main className="flex-1 overflow-y-auto relative p-6 md:p-12">
        {role === 'user' && (
          <button onClick={() => setShowLoginModal(true)} className="fixed bottom-6 right-6 p-4 bg-white border rounded-full shadow-lg text-slate-400 hover:text-indigo-600 z-50 transition-all hover:scale-110 active:scale-95">
            <Lock className="w-5 h-5" />
          </button>
        )}

        <div className="max-w-5xl mx-auto space-y-8">
          {activeView === 'generator' && (
            <div className="space-y-10 animate-in fade-in duration-500">
              <header className="text-center">
                <div className="flex flex-col md:flex-row items-center justify-center mb-12 space-y-8 md:space-y-0 md:space-x-12">
                  <img src="https://cdn.jsdelivr.net/gh/ginting719/Audio/LOGO-01.png" className="h-24 object-contain" alt="Alpro Logo" />
                  
                  <div className="flex flex-col items-center">
                    <ArrowRightLeft className="w-12 h-12 text-indigo-400 mb-2 animate-pulse" />
                    <span className="text-[10px] font-black text-indigo-300 tracking-[0.4em] uppercase">Synchronizing</span>
                  </div>

                  <img src="https://static.vecteezy.com/system/resources/previews/054/650/845/non_2x/tokopedia-logo-free-tokopedia-logo-download-free-png.png" className="h-20 object-contain" alt="Tokopedia Logo" />
                  
                  <img src="https://toppng.com/uploads/preview/tik-tok-logo-115495359236thjv7gf40.png" className="h-20 object-contain" alt="TikTok Logo" />
                </div>
                
                <h1 className="text-5xl font-black text-slate-900 tracking-tight leading-none mb-4">
                  Stock Sync <span className="text-indigo-600">Automation</span>
                </h1>
                <p className="text-slate-400 font-bold text-sm max-w-lg mx-auto leading-relaxed uppercase tracking-widest">
                  Otomatisasi Inventori Marketplace Multi-Channel
                </p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm space-y-8">
                  <div ref={dropdownRef}>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4 ml-1">1. Pilih Cabang</label>
                    <div className="relative">
                      <div className="w-full bg-slate-50 border-2 border-transparent focus-within:border-indigo-500 focus-within:bg-white rounded-2xl flex items-center transition-all cursor-text shadow-inner" onClick={() => setIsDropdownOpen(true)}>
                        <Search className="ml-5 w-4 h-4 text-slate-400" />
                        <input type="text" placeholder="Cari cabang..." value={isDropdownOpen ? searchTerm : (selectedStoreFilter || searchTerm)} onChange={(e) => { setSearchTerm(e.target.value); setIsDropdownOpen(true); }} className="flex-1 bg-transparent py-4 px-3 outline-none font-bold text-slate-800 uppercase" />
                        <ChevronDown className={`mr-5 w-4 h-4 text-slate-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                      </div>
                      {isDropdownOpen && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 max-h-64 overflow-y-auto p-1.5 animate-in slide-in-from-top-2">
                          {filteredStores.map((store, idx) => (
                            <button key={idx} onClick={() => { setSelectedStoreFilter(store); setSearchTerm(store); setIsDropdownOpen(false); }} className={`w-full text-left px-5 py-3.5 text-sm font-bold rounded-xl mb-1 hover:bg-indigo-50 transition-colors uppercase ${selectedStoreFilter === store ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>{store}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-8 border-t border-slate-100">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4 ml-1">2. Upload Template XLSX</label>
                    {tokopediaProducts.length === 0 ? (
                      <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-200 rounded-[32px] p-12 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 transition-all shadow-inner group">
                         <FileUp className="w-12 h-12 text-slate-300 mb-4 group-hover:scale-110 transition-transform" />
                         <span className="text-sm font-bold text-slate-400">Pilih template Tokopedia</span>
                         <input type="file" ref={fileInputRef} accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
                      </div>
                    ) : (
                      <div className="bg-slate-900 p-6 rounded-3xl flex items-center justify-between text-white shadow-xl animate-in slide-in-from-right-4">
                         <div className="flex items-center space-x-4 overflow-hidden">
                           <div className="bg-emerald-500/20 p-3 rounded-2xl">
                             <FileSpreadsheet className="w-8 h-8 text-emerald-400 shrink-0" />
                           </div>
                           <div className="truncate">
                             <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1">{detectedColumns?.templateType} MODE</p>
                             <p className="truncate font-black text-sm text-slate-200">{currentFileName}</p>
                           </div>
                         </div>
                         <button onClick={reset} className="p-3 bg-white/10 hover:bg-rose-500 rounded-xl transition-all shrink-0"><Trash2 className="w-5 h-5" /></button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div className="bg-slate-50 p-6 rounded-3xl space-y-4 border border-slate-100 shadow-inner">
                    <div className="flex justify-between items-center pb-4 border-b">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Store Filter</span>
                      <span className="font-black text-slate-900 text-sm truncate uppercase max-w-[180px] text-right">{selectedStoreFilter || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center pb-4 border-b">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Baris Data</span>
                      <span className="font-black text-slate-900 text-2xl tabular-nums">{tokopediaProducts.length}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Master Alpro</span>
                      <span className={`text-[10px] font-black px-3 py-1.5 rounded-lg uppercase ${fullMasterData.length ? 'bg-emerald-100 text-emerald-600 border border-emerald-200' : 'bg-slate-200 text-slate-400'}`}>{fullMasterData.length ? 'READY' : 'OFFLINE'}</span>
                    </div>
                  </div>
                  
                  <div className="mt-8 space-y-4">
                    {status !== ProcessStatus.COMPLETED ? (
                      <button onClick={runProcess} disabled={isProcessing || !selectedStoreFilter || !tokopediaProducts.length} 
                        className="w-full bg-indigo-600 text-white py-6 rounded-[32px] font-black text-xl hover:bg-indigo-700 disabled:opacity-20 shadow-xl flex items-center justify-center transition-all active:scale-95 group">
                        {isProcessing ? <RefreshCw className="animate-spin" /> : (
                          <>
                            <span>Generate</span>
                            <Zap className="ml-3 w-6 h-6 fill-white group-hover:scale-125 transition-transform" />
                          </>
                        )}
                      </button>
                    ) : (
                      <div className="space-y-4 animate-in zoom-in">
                        <button onClick={downloadFile} className="w-full bg-emerald-600 text-white py-6 rounded-[32px] font-black text-xl hover:bg-emerald-700 shadow-xl flex items-center justify-center animate-bounce-short">
                          <Download className="mr-3 w-6 h-6" /> UNDUH HASIL (.XLSX)
                        </button>
                        <button onClick={reset} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-indigo-600 py-2 text-center transition-colors">Reset Sesi</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {status === ProcessStatus.COMPLETED && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 animate-in slide-in-from-bottom-5">
                   <div className="bg-emerald-50 border border-emerald-100 p-8 rounded-[40px] flex items-center justify-between shadow-sm">
                      <div>
                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Berhasil Sinkron</p>
                        <div className="text-6xl font-black text-emerald-800 leading-none tabular-nums">{processedData.filter(p => p.is_matched).length}</div>
                        <p className="text-xs text-emerald-600/70 mt-3 font-bold">Harga & stok telah diselaraskan.</p>
                      </div>
                      <div className="bg-white p-5 rounded-2xl shadow-sm border border-emerald-100">
                        <CheckCircle2 className="w-14 h-14 text-emerald-600" />
                      </div>
                   </div>
                   <div className="bg-slate-100 border border-slate-200 p-8 rounded-[40px] flex items-center justify-between opacity-60">
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">SKU Dilewati</p>
                        <div className="text-6xl font-black text-slate-700 leading-none tabular-nums">{processedData.filter(p => !p.is_matched).length}</div>
                        <p className="text-xs text-slate-400 mt-3 font-bold">Tidak ditemukan di master data cabang ini.</p>
                      </div>
                      <div className="bg-white p-5 rounded-2xl shadow-sm">
                        <X className="w-14 h-14 text-slate-400" />
                      </div>
                   </div>
                </div>
              )}
            </div>
          )}

          {activeView === 'dashboard' && role === 'admin' && isLoggedIn && (
             <div className="animate-in slide-in-from-bottom-4 space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-8 rounded-[32px] border shadow-sm gap-4">
                   <div>
                      <h1 className="text-3xl font-black text-slate-900 leading-tight">Automation <span className="text-indigo-600">History</span></h1>
                      <p className="text-xs font-bold text-slate-400 mt-1">Laporan sinkronisasi harian per cabang.</p>
                   </div>
                   
                   <div className="flex items-center space-x-2 bg-slate-100/80 p-1.5 rounded-[22px] border border-slate-200 shadow-inner group">
                      <div className="flex items-center">
                         <label className="flex items-center space-x-2 px-4 py-2 hover:bg-white rounded-2xl cursor-pointer transition-all border border-transparent hover:border-slate-200 hover:shadow-sm">
                            <Calendar className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black text-slate-400 uppercase leading-none mb-1">Mulai</span>
                              <input 
                                type="date" 
                                value={historyStartDate} 
                                onChange={(e) => setHistoryStartDate(e.target.value)} 
                                className="bg-transparent text-[11px] font-black outline-none text-slate-700 w-24 h-4 uppercase" 
                              />
                            </div>
                         </label>

                         <div className="w-px h-6 bg-slate-300 mx-1" />

                         <label className="flex items-center space-x-2 px-4 py-2 hover:bg-white rounded-2xl cursor-pointer transition-all border border-transparent hover:border-slate-200 hover:shadow-sm">
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black text-slate-400 uppercase leading-none mb-1 text-right">Selesai</span>
                              <input 
                                type="date" 
                                value={historyEndDate} 
                                onChange={(e) => setHistoryEndDate(e.target.value)} 
                                className="bg-transparent text-[11px] font-black outline-none text-slate-700 w-24 h-4 uppercase" 
                              />
                            </div>
                         </label>
                      </div>

                      {(historyStartDate || historyEndDate) && (
                        <button 
                          onClick={() => { setHistoryStartDate(''); setHistoryEndDate(''); }} 
                          className="ml-1 p-2 bg-indigo-600 text-white rounded-full hover:bg-rose-500 transition-all shadow-lg active:scale-90"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                   </div>
                </div>

                <div className="bg-white rounded-[40px] border overflow-hidden shadow-sm">
                   <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        <tr><th className="px-8 py-5">Waktu</th><th className="px-8 py-5">Cabang</th><th className="px-8 py-5">File</th><th className="px-8 py-5 text-right">Hasil</th></tr>
                      </thead>
                      <tbody className="divide-y text-xs font-bold text-slate-600">
                         {filteredHistory.length > 0 ? filteredHistory.map((h, i) => (
                           <tr key={i} className="hover:bg-indigo-50/20 transition-colors">
                              <td className="px-8 py-5 text-slate-400 tabular-nums">{h.timestamp}</td>
                              <td className="px-8 py-5 text-slate-900 uppercase tracking-tight">{h.store}</td>
                              <td className="px-8 py-5 truncate max-w-[200px] italic text-slate-500">{h.file}</td>
                              <td className="px-8 py-5 text-right">
                                <span className="inline-flex items-center bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full text-[10px] font-black uppercase">
                                  {h.matchcount} / {h.skucount} SKU
                                </span>
                              </td>
                           </tr>
                         )) : (
                           <tr><td colSpan={4} className="px-8 py-20 text-center text-slate-400 font-bold italic">Tidak ada data ditemukan dalam rentang ini.</td></tr>
                         )}
                      </tbody>
                   </table>
                </div>
             </div>
          )}

          {activeView === 'logs' && role === 'admin' && isLoggedIn && (
            <div className="animate-in slide-in-from-bottom-4 space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-8 rounded-[32px] border shadow-sm gap-4">
                   <div>
                      <h1 className="text-3xl font-black text-slate-900 leading-tight italic">System <span className="text-indigo-600">Logs</span></h1>
                      <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-widest">Aktivitas & Performa Sistem Real-time</p>
                   </div>
                   <div className="flex items-center space-x-3 w-full md:w-auto">
                      <div className="flex-1 md:w-64 bg-slate-50 border border-slate-200 rounded-2xl flex items-center px-4 py-2.5 transition-all focus-within:border-indigo-500 focus-within:bg-white">
                         <Search className="w-4 h-4 text-slate-400 mr-3" />
                         <input type="text" placeholder="Cari log..." value={logSearchQuery} onChange={(e) => setLogSearchQuery(e.target.value)} className="bg-transparent outline-none text-sm font-bold w-full" />
                      </div>
                      <button onClick={fetchLogs} className="p-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-all shadow-lg active:scale-95"><RefreshCw className="w-5 h-5" /></button>
                   </div>
                </div>

                <div className="bg-white rounded-[40px] border overflow-hidden shadow-sm">
                   <div className="max-h-[600px] overflow-y-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b text-[10px] font-black text-slate-400 uppercase tracking-widest sticky top-0 z-10">
                          <tr><th className="px-8 py-5">Timestamp</th><th className="px-8 py-5">Type</th><th className="px-8 py-5">Message</th></tr>
                        </thead>
                        <tbody className="divide-y text-[11px] font-bold">
                           {filteredLogs.length > 0 ? filteredLogs.map((l, i) => (
                             <tr key={l.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-8 py-4 text-slate-400 tabular-nums whitespace-nowrap">{l.timestamp}</td>
                                <td className="px-8 py-4">
                                   <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                                     l.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                     l.type === 'error' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                                     'bg-blue-50 text-blue-600 border-blue-100'
                                   }`}>
                                     {l.type}
                                   </span>
                                </td>
                                <td className={`px-8 py-4 ${l.type === 'error' ? 'text-rose-600' : 'text-slate-700'}`}>
                                   {l.message}
                                </td>
                             </tr>
                           )) : (
                             <tr><td colSpan={3} className="px-8 py-20 text-center text-slate-400 font-bold italic">Log tidak ditemukan.</td></tr>
                           )}
                        </tbody>
                      </table>
                   </div>
                </div>
            </div>
          )}
        </div>
      </main>

      {showLoginModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-[40px] w-full max-w-md p-10 shadow-2xl relative animate-in zoom-in-95">
            <button onClick={() => setShowLoginModal(false)} className="absolute top-8 right-8 text-slate-300 hover:text-slate-900 transition-colors"><X /></button>
            <div className="text-center mb-10">
               <div className="bg-indigo-600 inline-block p-5 rounded-[24px] mb-4 shadow-xl shadow-indigo-100"><Lock className="text-white w-6 h-6" /></div>
               <h2 className="text-2xl font-black text-slate-900 tracking-tight italic text-center">Portal Administrator</h2>
               <p className="text-slate-400 text-xs mt-2 font-bold uppercase tracking-widest">Silakan login untuk akses dashboard</p>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if(loginId === ADMIN_ID && loginPass === ADMIN_PASS) { setIsLoggedIn(true); setRole('admin'); localStorage.setItem('is_admin_logged_in', 'true'); setShowLoginModal(false); addLog("Admin berhasil login ke sistem.", "success"); } else setLoginError("ID atau Password salah."); }} className="space-y-4">
               <input type="text" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="Username" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-4 px-6 outline-none font-bold text-lg focus:border-indigo-500 transition-all shadow-inner" />
               <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder="Password" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-4 px-6 outline-none font-bold text-lg focus:border-indigo-500 transition-all shadow-inner" />
               {loginError && <p className="text-rose-500 text-xs font-bold text-center italic">{loginError}</p>}
               <button type="submit" className="w-full bg-slate-900 text-white py-4.5 rounded-2xl font-black text-xl hover:bg-slate-800 transition-all shadow-xl active:scale-95 mt-4">Login Admin</button>
            </form>
          </div>
        </div>
      )}
      <style>{`
        @keyframes bounce-short { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        .animate-bounce-short { animation: bounce-short 3s infinite ease-in-out; }
        .py-4.5 { padding-top: 1.125rem; padding-bottom: 1.125rem; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
        
        input[type="date"]::-webkit-calendar-picker-indicator {
          background: transparent;
          bottom: 0;
          color: transparent;
          cursor: pointer;
          height: auto;
          left: 0;
          position: absolute;
          right: 0;
          top: 0;
          width: auto;
        }
        input[type="date"] {
          position: relative;
        }
      `}</style>
    </div>
  );
};

export default App;
