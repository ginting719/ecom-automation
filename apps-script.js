const SPREADSHEET_ID = '198G48Zt5eFfQcUZ2wH1fjnkzBHGMMfS4P-WvJvkMH6M';

function doGet(e) {
  const type = e.parameter.type;
  if (!type) {
    return ContentService.createTextOutput(JSON.stringify({ error: "No type provided" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  if (type === 'MasterData') {
    // 1. Process TOKOPEDIA sheet for Price and Factor
    let products = [];
    const sheetTokopedia = ss.getSheetByName('TOKOPEDIA');
    if (sheetTokopedia) {
      const dataTokopedia = sheetTokopedia.getDataRange().getValues();
      const headersTokopedia = dataTokopedia.shift() || [];
      
      const idxCode = headersTokopedia.findIndex(h => String(h).toLowerCase().includes('item code'));
      const idxDesc = headersTokopedia.findIndex(h => String(h).toLowerCase().includes('description'));
      const idxFactor = headersTokopedia.findIndex(h => String(h).toLowerCase().includes('factor'));
      let idxPrice = headersTokopedia.findIndex(h => {
        const s = String(h).toLowerCase().trim();
        return s === 'round up harga' || s.includes('round up harga');
      });
      if (idxPrice === -1) {
        idxPrice = headersTokopedia.findIndex(h => {
          const s = String(h).toLowerCase();
          return s.includes('harga ecom') || s.includes('harga');
        });
      }
      const idxStatus = headersTokopedia.findIndex(h => String(h).toLowerCase().includes('status tokped'));
      const codeColT = idxCode !== -1 ? idxCode : 0;
      
      products = dataTokopedia
        .filter(row => row[codeColT] !== undefined && String(row[codeColT]).trim() !== '')
        .map(row => {
          const statusVal = idxStatus !== -1 ? String(row[idxStatus] || '').trim() : 'Jual';
          return {
            sku: String(row[codeColT]).trim(),
            desc: String(row[idxDesc !== -1 ? idxDesc : 1] || '').trim(),
            factor: String(row[idxFactor !== -1 ? idxFactor : 2] || '').trim(),
            price: String(row[idxPrice !== -1 ? idxPrice : 3] || '').trim(),
            statusTokped: statusVal
          };
        });
    }

    // 2. Process STOCK sheet for branch inventory
    let stocks = [];
    const sheetStock = ss.getSheetByName('STOCK');
    if (sheetStock) {
      const dataStock = sheetStock.getDataRange().getValues();
      const headersStock = dataStock.shift() || [];

      const sIdxBranch = headersStock.findIndex(h => {
        const s = String(h).toLowerCase();
        return s.includes('nama toko') || s.includes('branch') || s.includes('cabang');
      });
      const sIdxCode = headersStock.findIndex(h => {
        const s = String(h).toLowerCase();
        return s.includes('item code') || s.includes('sku');
      });
      const sIdxStock = headersStock.findIndex(h => {
        const s = String(h).toLowerCase();
        return s.includes('stok') || s.includes('stock') || s.includes('qty') || s.includes('kuantitas');
      });
      
      const branchCol = sIdxBranch !== -1 ? sIdxBranch : 0; 
      const codeCol = sIdxCode !== -1 ? sIdxCode : 2;
      const stockCol = sIdxStock !== -1 ? sIdxStock : 4; 
      
      stocks = dataStock
        .filter(row => row[codeCol] !== undefined && String(row[codeCol]).trim() !== '' && row[branchCol] !== undefined && String(row[branchCol]).trim() !== '')
        .map(row => {
          return {
            branch: String(row[branchCol]).trim(),
            sku: String(row[codeCol]).trim(),
            stock: String(row[stockCol] || '').trim()
          };
        });
    }
    
    return ContentService.createTextOutput(JSON.stringify({ products, stocks }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (type === 'History' || type === 'LOG TTS') {
     const sheet = ss.getSheetByName('LOG TTS');
     if(!sheet) return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
     
     const data = sheet.getDataRange().getValues();
     data.shift(); // remove headers
     const list = data.map(row => ({
        id: row[0],
        timestamp: row[1],
        store: row[2],
        file: row[3],
        skucount: row[4],
        matchcount: row[5]
     }));
     return ContentService.createTextOutput(JSON.stringify(list))
       .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify([]))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Invalid JSON" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const type = data.type;
  const payload = data.payload;
  
  if (type === 'History' || type === 'LOG TTS') {
    let sheet = ss.getSheetByName('LOG TTS');
    if(!sheet) {
       sheet = ss.insertSheet('LOG TTS');
       sheet.appendRow(['ID', 'Timestamp', 'Store', 'File', 'SKU Count', 'Match Count']);
    }
    sheet.appendRow(payload);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Ensure you deploy this as a Web App following Google's "Deploy -> New deployment" process
// Choose "Execute as: Me" and "Who has access: Anyone"
