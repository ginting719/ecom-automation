
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Download, RefreshCw, CheckCircle2, 
  Trash2, LayoutDashboard, ClipboardList, 
  FileSpreadsheet, Zap,
  FileUp, X, Settings, Lock, LogOut, Search, ChevronDown, ArrowRightLeft, Calendar, Filter,
  Play
} from 'lucide-react';
import { ProcessStatus, Product, ProcessedProduct, ViewType, HistoryEntry, LogEntry, MasterData, Role, EcomProduct, StoreStock } from './types';
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
  const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbzTPYzYAgKtMxF78leUfgjcr5zV73dKkbsKzz3NDQ8LbXjCiFGACEveeN5X5zCcvMEvMg/exec';
  const ADMIN_ID = 'apotekalpro';
  const ADMIN_PASS = 'Ecommerce1';
  
  const [role, setRole] = useState<Role>(() => (localStorage.getItem('user_role') as Role) || 'user');
  const [isLoggedIn, setIsLoggedIn] = useState(() => localStorage.getItem('is_admin_logged_in') === 'true');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeView, setActiveView] = useState<ViewType>('generator');
  const [appsScriptUrl, setAppsScriptUrl] = useState(() => {
    // Selalu paksa menggunakan DEFAULT_URL terbaru dari codebase agar
    // pengguna lama di GitHub Pages tidak terjebak dengan caching URL Apps Script lama di localStorage.
    localStorage.setItem('apps_script_url', DEFAULT_URL);
    return DEFAULT_URL;
  });
  
  const [status, setStatus] = useState<ProcessStatus>(ProcessStatus.IDLE);
  const [fullMasterData, setFullMasterData] = useState<MasterData[]>([]);
  const [ecomProducts, setEcomProducts] = useState<EcomProduct[]>([]);
  const [storeStocks, setStoreStocks] = useState<StoreStock[]>([]);
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
  const [uploadError, setUploadError] = useState('');
  const [detectedColumns, setDetectedColumns] = useState<ColumnIndices | null>(null);

  // Filter States
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
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
      
      let stores: string[] = [];
      if (rawData && rawData.products && rawData.stocks) {
        const normalizedProducts: EcomProduct[] = rawData.products.map((p: any) => ({
          sku: String(p.sku || ''),
          desc: String(p.desc || ''),
          factor: parseIndoNumber(p.factor) || 1,
          price: parseIndoNumber(p.price) || 0,
          statusTokped: p.statusTokped
        }));

        const normalizedStocks: StoreStock[] = rawData.stocks.map((s: any) => ({
          sku: String(s.sku || ''),
          branch: String(s.branch || ''),
          stock: parseIndoNumber(s.stock) || 0
        }));

        setEcomProducts(normalizedProducts);
        setStoreStocks(normalizedStocks);

        // Ensure legacy state is somewhat populated if used
        setFullMasterData(normalizedProducts.map((p: EcomProduct) => ({
           sku: String(p.sku || '').trim().toLowerCase(),
           harga: p.price,
           stok: 0,
           storeName: "Data Terpusat",
           storeCode: "" 
        })));
        stores = Array.from(new Set(normalizedStocks.map((m: StoreStock) => String(m.branch)))).filter(Boolean).sort() as string[];
      } else if (rawData && Array.isArray(rawData)) { // Legacy fallback
        const normalizedData: MasterData[] = rawData.map((item: any) => ({
          sku: String(item.sku || '').trim().toLowerCase(),
          harga: Number(item.harga) || 0,
          stok: Number(item.stok) || 0,
          storeName: String(item.storeName || '').trim(),
          storeCode: "" 
        }));

        setFullMasterData(normalizedData);
        stores = Array.from(new Set(normalizedData.map(m => String(m.storeName)))).filter(Boolean).sort() as string[];
      }
      setAvailableStores(stores as string[]);
      setStatus(ProcessStatus.READY_TO_PROCESS);
    } catch (e) {
      console.error("Gagal menarik data master", e);
    } finally {
      setIsProcessing(false);
    }
  }, [appsScriptUrl]);

  const fetchHistory = useCallback(async () => {
    if (!appsScriptUrl || role !== 'admin' || !isLoggedIn) return;
    try {
      const resp = await fetch(`${appsScriptUrl}?type=LOG TTS`);
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

  const syncToCloud = async (type: 'LOG TTS', payload: any[]) => {
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
  };

  const findHeaderIndices = (rows: any[][]): { rowIndex: number, indices: ColumnIndices } | null => {
    for (let r = 0; r < 25; r++) {
      const row = rows[r];
      if (!row) continue;
      
      const skuIdx = row.findIndex(c => {
        const s = String(c || '').toLowerCase().replace(/\s+/g, ' ').trim();
        return s.includes('sku penju') || s.includes('seller sku') || s.includes('nomor sku') || s === 'sku' || s.includes('kode variasi') || s === 'sku induk';
      });

      if (skuIdx !== -1) {
        const hargaIdx = row.findIndex(c => {
           const s = String(c || '').toLowerCase().replace(/\s+/g, ' ').trim();
           return s.includes('harga ritel') || s.includes('harga') || s.includes('price');
        });
        
        const stokCols: number[] = [];
        row.forEach((cell, idx) => {
          const s = String(cell || '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (s.includes('stok') || s.includes('stock') || s.includes('kuantitas') || s.includes('quantity') || s.includes('jumlah di') || (s.includes('jumlah') && !s.includes('penjualan') && !s.includes('minimum'))) {
             stokCols.push(idx);
          }
        });

        const namaIdx = row.findIndex(c => {
           const s = String(c || '').toLowerCase().replace(/\s+/g, ' ').trim();
           return s.includes('nama produk') || s.includes('product name') || s.includes('nama item');
        });
        
        const idSkuIdx = row.findIndex(c => {
           const s = String(c || '').toLowerCase().replace(/\s+/g, ' ').trim();
           return s.includes('id sku') || s.includes('product id');
        });

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
    setUploadError('');
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
          setUploadError(`Header file '${file.name}' tidak dapat dikenali (kolom SKU tidak ditemukan). Pastikan ini template Tokopedia/TikTok/Shopee yang benar.`);
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

        if (products.length === 0) {
           setUploadError(`Tidak ada data produk yang valid ditemukan di template '${file.name}'. Baris mungkin kosong.`);
           return;
        }

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

    let matches = 0;

    // Build Lookups for new logic
    const ecomLookup = new Map<string, EcomProduct>();
    ecomProducts.forEach(e => ecomLookup.set(String(e.sku).toLowerCase().trim(), e));
    
    const stockLookup = new Map<string, StoreStock>();
    storeStocks
      .filter(s => String(s.branch).toLowerCase() === String(selectedStoreFilter).toLowerCase())
      .forEach(s => stockLookup.set(String(s.sku).toLowerCase().trim(), s));

    // Legacy lookup
    const masterLookup = new Map<string, MasterData>();
    fullMasterData
      .filter(m => String(m.storeName || '').toLowerCase() === String(selectedStoreFilter || '').toLowerCase())
      .forEach(m => masterLookup.set(m.sku, m));

    const result: ProcessedProduct[] = tokopediaProducts.map(p => {
      const cleanSku = String(p.sku_penjual || '').toLowerCase().trim();
      
      // Feature check: are we using the new separate datasets?
      if (ecomProducts.length > 0 || storeStocks.length > 0) {
        let parentSku = cleanSku;
        let isTurunan = false;
        if (cleanSku.startsWith('t') || cleanSku.startsWith('l')) {
          parentSku = cleanSku.substring(1);
          isTurunan = true;
        }

        const ecomData = ecomLookup.get(cleanSku) || ecomLookup.get(parentSku);
        
        // Dapatkan stok pusat (semua stok turunan L/T maupun utama berasal dari item utama di list STOK)
        const parentStockData = stockLookup.get(parentSku);
        const parentRawStock = parentStockData ? parentStockData.stock : 0;

        // Dapatkan ecom data dan factor untuk item utama
        const parentEcomData = ecomLookup.get(parentSku);
        const parentFactor = parentEcomData && parentEcomData.factor > 0 ? parentEcomData.factor : 1;

        // Hitung hasil stok dasar/utama (stok utama = Math.floor((stok_utama_riil * 0.75) / factor_utama))
        const parentDbStock = Math.floor((parentRawStock * 0.75) / parentFactor);

        const factor = ecomData && ecomData.factor > 0 ? ecomData.factor : 1;
        const finalPrice = ecomData && ecomData.price > 0 ? ecomData.price : p.harga_ritel;
        const statusTokpedStr = String(ecomData?.statusTokped || 'jual').toLowerCase().trim();

        let dbStock = 0;
        if (statusTokpedStr === 'tidak jual') {
          dbStock = 0;
        } else {
          if (isTurunan) {
            // Maka item turunan (L/T) adalah hasil stok utama dibagi factor rincian dari item turunan tersebut
            dbStock = Math.floor(parentDbStock / factor);
          } else {
            dbStock = parentDbStock;
          }
        }

        if (ecomData || parentStockData) {
          matches++;
          return { 
            ...p, 
            updated_price: finalPrice, 
            updated_stock: Math.max(0, dbStock), 
            is_matched: true 
          };
        }
      } else {
        // Legacy fallback execution
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
      }

      // Jika di template ada item ketika lookup ga ada yg cocok maka buatkan generate untuk stok dan harganya jadi 0 semua.
      return { ...p, updated_price: 0, updated_stock: 0, is_matched: false };
    });

    setProcessedData(result);
    setIsProcessing(false);
    setStatus(ProcessStatus.COMPLETED);
    addLog(`Generate Selesai: ${matches} SKU dari ${result.length} berhasil disinkronisasi.`, 'success');
    syncToCloud('LOG TTS', [Date.now().toString(), new Date().toLocaleString('id-ID', { hour12: false }), selectedStoreFilter, currentFileName, result.length, matches]);
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
    
    // Perbarui semua SKU baik yang is_matched maupun tidak (untuk unmatched item harga & stok diset 0)
    processedData.forEach(p => {
      const pCell = XLSX.utils.encode_cell({ r: p.rowRef, c: detectedColumns.hargaRitel });
      if (!sheet[pCell]) {
        sheet[pCell] = { v: Number(p.updated_price), t: 'n' };
      } else {
        // Update nilainya secara in-place agar tidak merusak style & format cell bawaan template
        sheet[pCell].v = Number(p.updated_price);
        sheet[pCell].t = 'n';
        if (sheet[pCell].w !== undefined) delete sheet[pCell].w;
        if (sheet[pCell].f !== undefined) delete sheet[pCell].f;
      }
      
      detectedColumns.stokCols.forEach(colIdx => {
        const qCell = XLSX.utils.encode_cell({ r: p.rowRef, c: colIdx });
        if (!sheet[qCell]) {
          sheet[qCell] = { v: Number(p.updated_stock), t: 'n' };
        } else {
          sheet[qCell].v = Number(p.updated_stock);
          sheet[qCell].t = 'n';
          if (sheet[qCell].w !== undefined) delete sheet[qCell].w;
          if (sheet[qCell].f !== undefined) delete sheet[qCell].f;
        }
      });
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
    setUploadError(''); setDetectedColumns(null); setStatus(ProcessStatus.READY_TO_PROCESS);
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
      }
    }
  }, [appsScriptUrl, role, isLoggedIn, activeView, fetchHistory]);

  const filteredStores = availableStores.filter(s => String(s || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()));

  const filteredHistory = history.filter(h => {
    // Filter by Search Query (Cabang)
    const matchesSearch = !historySearchQuery || 
      String(h.store || '').toLowerCase().includes(historySearchQuery.toLowerCase());
    
    if (!matchesSearch) return false;

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
        {/* Floating Video Guide Widget */}
        <div 
          className={`fixed ${role === 'user' ? 'bottom-[84px]' : 'bottom-6'} right-6 flex items-center z-40`}
        >
          {/* Label outside the circular button, to the left */}
          <div className="mr-3 bg-gradient-to-r from-red-600 to-rose-600 text-white px-4 py-2 rounded-2xl text-[11px] font-bold shadow-lg relative after:content-[''] after:absolute after:top-1/2 after:-translate-y-1/2 after:left-full after:border-[6px] after:border-transparent after:border-l-rose-600 animate-bounce-horizontal select-none">
            jika bingung, bisa tonton aku ya
          </div>
          {/* Circular Button resembling the lock icon */}
          <button 
            id="btn-tutorial-video"
            onClick={() => setShowVideoModal(true)} 
            className="p-4 bg-white border border-slate-100 rounded-full shadow-lg text-red-600 hover:text-red-700 hover:shadow-xl transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
            title="Tonton tutorial video"
          >
            <Play className="w-5 h-5 fill-red-600 text-red-600" />
          </button>
        </div>

        {role === 'user' && (
          <button id="btn-admin-lock" onClick={() => setShowLoginModal(true)} className="fixed bottom-6 right-6 p-4 bg-white border rounded-full shadow-lg text-slate-400 hover:text-indigo-600 z-40 transition-all hover:scale-110 active:scale-95">
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
                    {uploadError && (
                      <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-start">
                         <X className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
                         <span>{uploadError}</span>
                      </div>
                    )}
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
                   
                   <div className="flex flex-col md:flex-row items-center gap-4">
                      <div className="flex items-center bg-slate-100/80 border border-slate-200 rounded-[22px] px-4 py-2 shadow-inner w-full md:w-64 focus-within:border-indigo-500 focus-within:bg-white transition-all">
                         <Search className="w-4 h-4 text-slate-400 mr-2" />
                         <input 
                           type="text" 
                           placeholder="Cari cabang..." 
                           value={historySearchQuery} 
                           onChange={(e) => setHistorySearchQuery(e.target.value)} 
                           className="bg-transparent outline-none text-sm font-bold w-full text-slate-700"
                         />
                         {historySearchQuery && (
                           <button onClick={() => setHistorySearchQuery('')} className="ml-2 text-slate-400 hover:text-rose-500">
                             <X className="w-3.5 h-3.5" />
                           </button>
                         )}
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

      {showVideoModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-10 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-slate-900 rounded-[32px] w-full max-w-4xl overflow-hidden shadow-2xl relative border border-slate-800 animate-in zoom-in-95 duration-300">
            {/* Header bar within modular popup */}
            <div className="bg-slate-950/90 py-4 px-6 flex justify-between items-center text-white border-b border-slate-800 absolute top-0 left-0 right-0 z-10">
              <div className="flex items-center space-x-2">
                <Play className="w-4 h-4 text-red-500 fill-red-500" />
                <span className="font-extrabold text-xs tracking-wider uppercase">Video Tutorial & Panduan</span>
              </div>
              <button 
                onClick={() => setShowVideoModal(false)} 
                className="p-1.5 bg-slate-800 hover:bg-rose-600 rounded-full text-slate-300 hover:text-white transition-all active:scale-90"
                title="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video embed element taking standard 16:9 aspect-video */}
            <div className="pt-14 aspect-video w-full bg-black">
              <iframe
                id="instructions-video-iframe"
                width="100%"
                height="100%"
                src="https://www.youtube.com/embed/VobLK3z_ztg?autoplay=1"
                title="Panduan Sinkronisasi Multi-Channel"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="w-full h-full"
              ></iframe>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes bounce-short { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        .animate-bounce-short { animation: bounce-short 3s infinite ease-in-out; }
        @keyframes bounce-horizontal { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-6px); } }
        .animate-bounce-horizontal { animation: bounce-horizontal 2s infinite ease-in-out; }
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
