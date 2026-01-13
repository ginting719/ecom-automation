
export type Role = 'admin' | 'user';

export interface Product {
  id_produk: string;
  kategori: string;
  nama_produk: string;
  id_sku: string;
  nilai_variasi: string;
  harga_ritel: number;
  kuantitas: number;
  sku_penjual: string;
  min_order: string;
  original_row: any[];
  rowRef: number;
}

export interface MasterData {
  sku: string;
  harga: number;
  stok: number;
  storeName: string;
  storeCode: string;
}

export interface ProcessedProduct extends Product {
  updated_stock: number;
  updated_price: number;
  master_stock?: number;
  is_matched: boolean;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  file: string;      // Sesuai kolom 'File' di spreadsheet
  store: string;     // Sesuai kolom 'Store' di spreadsheet
  skucount: number;  // Sesuai kolom 'SKU Count' (biasanya dinormalisasi Apps Script)
  matchcount: number; // Sesuai kolom 'Match Count'
}

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export enum ProcessStatus {
  IDLE = 'IDLE',
  READY_TO_PROCESS = 'READY_TO_PROCESS',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED'
}

export type ViewType = 'generator' | 'dashboard' | 'logs' | 'settings';
