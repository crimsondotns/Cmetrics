require('dotenv').config();
const { google } = require('googleapis');
const cliProgress = require('cli-progress');
const path = require('path');
const fs = require('fs');

// ================= การตั้งค่าจาก Environment Variables =================
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CMC_API_KEY = process.env.CMC_API_KEY;
const KEY_FILE = './credentials.json';
// ===========================================

// ตรวจสอบว่า Environment Variables ครบถ้วน
if (!SPREADSHEET_ID || !CMC_API_KEY) {
  console.error('❌ กรุณาตั้งค่า Environment Variables: SPREADSHEET_ID, CMC_API_KEY');
  console.error('   ดูตัวอย่างได้ที่ไฟล์ .env.example');
  process.exit(1);
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * แปลง timestamp เป็น Format วันที่ไทย (GMT+7)
 * @param {string} timestamp - ISO 8601 timestamp
 * @returns {string} MM/DD/YYYY HH:mm:ss (Asia/Bangkok)
 */
function formatThaiDateTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const opts = { timeZone: 'Asia/Bangkok', hour12: false };
  const mm = d.toLocaleString('en-US', { ...opts, month: '2-digit' });
  const dd = d.toLocaleString('en-US', { ...opts, day: '2-digit' });
  const yyyy = d.toLocaleString('en-US', { ...opts, year: 'numeric' });
  const time = d.toLocaleString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${mm}/${dd}/${yyyy} ${time}`;
}

/**
 * สร้าง Google Auth client รองรับทั้ง keyFile (local) และสร้างไฟล์จาก credentials JSON string (CI/CD)
 */
async function createAuthClient() {
  // หากมีการตั้งค่า GOOGLE_CREDENTIALS (เช่น ใน GitHub Actions) ให้เขียนเป็นไฟล์
  if (process.env.GOOGLE_CREDENTIALS) {
    fs.writeFileSync(KEY_FILE, process.env.GOOGLE_CREDENTIALS.trim());
    console.log('📝 สร้างไฟล์ credentials.json ชั่วคราวจาก Environment Variables แล้ว');
  }

  // ตรวจสอบว่ามีไฟล์หรือไม่
  if (!fs.existsSync(KEY_FILE)) {
    console.error(`❌ ไม่พบไฟล์ ${KEY_FILE} และไม่ได้กำหนด GOOGLE_CREDENTIALS`);
    process.exit(1);
  }

  console.log(`🔑 ใช้ credentials จากไฟล์: ${KEY_FILE}`);
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth.getClient();
}

// ================= กำหนด Header ให้ครอบคลุมทุก Timeframe (ตัด 7d, 30d ออก) =================
const HEADERS = [
  // ข้อมูลหลัก
  "n", "sym", "addr", "plt", "pdex", "pcid", "pid", "dec", "crt", "own", 
  "web", "tw", "tg", "lg", "pubAt", "mcap", "ts", "liqUsd", "hld", "p", 
  "ph24h", "pl24h", "pt", "fpt", "fpct",
  
  // sts (Stats) - 1 นาที
  "sts_1m_vu", "sts_1m_txs", "sts_1m_nb", "sts_1m_ns", "sts_1m_bvu", "sts_1m_svu", "sts_1m_but", "sts_1m_sut", "sts_1m_pc", "sts_1m_ut",
  // sts (Stats) - 5 นาที
  "sts_5m_vu", "sts_5m_txs", "sts_5m_nb", "sts_5m_ns", "sts_5m_bvu", "sts_5m_svu", "sts_5m_but", "sts_5m_sut", "sts_5m_pc", "sts_5m_ut",
  // sts (Stats) - 1 ชั่วโมง
  "sts_1h_vu", "sts_1h_txs", "sts_1h_nb", "sts_1h_ns", "sts_1h_bvu", "sts_1h_svu", "sts_1h_but", "sts_1h_sut", "sts_1h_pc", "sts_1h_ut",
  // sts (Stats) - 4 ชั่วโมง
  "sts_4h_vu", "sts_4h_txs", "sts_4h_nb", "sts_4h_ns", "sts_4h_bvu", "sts_4h_svu", "sts_4h_but", "sts_4h_sut", "sts_4h_pc", "sts_4h_ut",
  // sts (Stats) - 24 ชั่วโมง
  "sts_24h_vu", "sts_24h_txs", "sts_24h_nb", "sts_24h_ns", "sts_24h_bvu", "sts_24h_svu", "sts_24h_but", "sts_24h_sut", "sts_24h_pc", "sts_24h_ut",
  
  // pls (Pools) - ดึงข้อมูล Pool แรก
  "pls_addr", "pls_v24", "pls_pubAt", 
  "pls_t0_addr", "pls_t0_lg", "pls_t0_n", "pls_t0_sym", "pls_t0_liq", "pls_t0_liqUsd",
  "pls_t1_addr", "pls_t1_lg", "pls_t1_n", "pls_t1_sym", "pls_t1_liq", "pls_t1_liqUsd",
  "pls_bidx", "pls_exid", "pls_exn", "pls_liqUsd", "pls_fa", "pls_lr", "pls_mi",
  
  // ข้อมูลที่เหลือ
  "turl", "nps", "tsrc", "rl", "lf", "cid", "lmc", "lsmc", "lsrcs", "ltcs", "ltda", 
  "cexs", "ecs", "la",
  
  // สถานะ API (Status)
  "status_timestamp", "status_error_code", "status_error_message", "status_elapsed", "status_credit_count"
];

async function main() {
  console.log('🔄 กำลังเตรียมความพร้อมและยืนยันตัวตนกับ Google...');
  const client = await createAuthClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  try {
    const readResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'subscription!H3:J',
    });

    const rows = readResponse.data.values;
    if (!rows || rows.length === 0) {
      console.log('⚠️ ไม่พบข้อมูลในชีต subscription');
      return;
    }

    const results = [HEADERS];
    let errorCount = 0;

    console.log(`\nพบข้อมูลทั้งหมด ${rows.length} รายการ`);

    const progressBar = new cliProgress.SingleBar({
      format: '🚀 ดึงข้อมูล API... |{bar}| {percentage}% | {value}/{total} | Fetching: {symbol}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(rows.length, 0, { symbol: 'Starting...' });
    const startTime = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const address = rows[i][0]; 
      const platform = rows[i][2]; 

      if (!address || !platform) {
        progressBar.increment();
        continue;
      }

      const poolAddress = rows[i][1] || ''; // คอลัมน์ I = Pool Address
      progressBar.update(i, { symbol: address });

      try {
        const url = new URL('https://pro-api.coinmarketcap.com/v1/dex/token');
        url.searchParams.append('platform', platform);
        url.searchParams.append('address', address);

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Host': 'pro-api.coinmarketcap.com',
            'User-Agent': 'Zudoku Playground',
            'x-cmc_pro_api_key': CMC_API_KEY
          }
        });

        if (!response.ok) throw new Error(`${response.status}`);

        const json = await response.json();
        const d = json.data || {};
        const status = json.status || {};

        // === ค้นหาสถิติในทุกๆ Timeframe ===
        const stsArray = Array.isArray(d.sts) ? d.sts : [];
        const sts_1m  = stsArray.find(s => s.tp === '1m') || {};
        const sts_5m  = stsArray.find(s => s.tp === '5m') || {};
        const sts_1h  = stsArray.find(s => s.tp === '1h') || {};
        const sts_4h  = stsArray.find(s => s.tp === '4h') || {};
        const sts_24h = stsArray.find(s => s.tp === '24h') || {};
        
        // === เลือก Pool ที่ตรงกับ pool address จากชีต subscription (คอลัมน์ I) ===
        const plsArray = Array.isArray(d.pls) ? d.pls : [];
        const pls = plsArray.find(p => p.addr && p.addr.toLowerCase() === poolAddress.toLowerCase()) || plsArray[0] || {};
        const t0 = pls.t0 || {};
        const t1 = pls.t1 || {};

        // อัปเดต progress bar ให้แสดง symbol จาก API
        progressBar.update(i, { symbol: d.sym || address });
        
        // CEXs แปลงเป็น String จะได้ลง 1 ช่องพอดี
        const cexsStr = (d.cexs && Array.isArray(d.cexs) && d.cexs.length > 0) ? d.cexs.map(c => c.n).filter(Boolean).join(', ') : ''; 

        // แมปข้อมูลลง Array ให้ตรงกับ HEADERS เป๊ะๆ
        results.push([
          // ข้อมูลหลัก
          d.n || '', d.sym || '', d.addr || '', d.plt || '', d.pdex || '', d.pcid || 0, d.pid || 0, d.dec || 0, d.crt || '', d.own || '', 
          d.web || '', d.tw || '', d.tg || '', d.lg || '', d.pubAt || '', d.mcap || '', d.ts || '', d.liqUsd || '', d.hld || '', d.p || '', 
          d.ph24h || '', d.pl24h || '', d.pt || '', d.fpt || '', d.fpct || '',

          // sts (Stats) - 1m
          sts_1m.vu || '', sts_1m.txs || '', sts_1m.nb || '', sts_1m.ns || '', sts_1m.bvu || '', sts_1m.svu || '', sts_1m.but || '', sts_1m.sut || '', sts_1m.pc || 0, sts_1m.ut || '',
          // sts (Stats) - 5m
          sts_5m.vu || '', sts_5m.txs || '', sts_5m.nb || '', sts_5m.ns || '', sts_5m.bvu || '', sts_5m.svu || '', sts_5m.but || '', sts_5m.sut || '', sts_5m.pc || 0, sts_5m.ut || '',
          // sts (Stats) - 1h
          sts_1h.vu || '', sts_1h.txs || '', sts_1h.nb || '', sts_1h.ns || '', sts_1h.bvu || '', sts_1h.svu || '', sts_1h.but || '', sts_1h.sut || '', sts_1h.pc || 0, sts_1h.ut || '',
          // sts (Stats) - 4h
          sts_4h.vu || '', sts_4h.txs || '', sts_4h.nb || '', sts_4h.ns || '', sts_4h.bvu || '', sts_4h.svu || '', sts_4h.but || '', sts_4h.sut || '', sts_4h.pc || 0, sts_4h.ut || '',
          // sts (Stats) - 24h
          sts_24h.vu || '', sts_24h.txs || '', sts_24h.nb || '', sts_24h.ns || '', sts_24h.bvu || '', sts_24h.svu || '', sts_24h.but || '', sts_24h.sut || '', sts_24h.pc || 0, sts_24h.ut || '',

          // pls (Pools)
          pls.addr || '', pls.v24 || '', pls.pubAt || '', 
          t0.addr || '', t0.lg || '', t0.n || '', t0.sym || '', t0.liq || '', t0.liqUsd || '',
          t1.addr || '', t1.lg || '', t1.n || '', t1.sym || '', t1.liq || '', t1.liqUsd || '',
          pls.bidx || 0, pls.exid || 0, pls.exn || '', pls.liqUsd || '', pls.fa || '', pls.lr || '', pls.mi !== undefined ? pls.mi : '',

          // ข้อมูลที่เหลือ
          d.turl || '', d.nps || '', d.tsrc || '', d.rl || '', d.lf || 0, d.cid || 0, d.lmc || '', d.lsmc || '', d.lsrcs || '', d.ltcs || '', d.ltda || '', 
          cexsStr, d.ecs || 0, d.la || 0,

          // สถานะ API
          formatThaiDateTime(status.timestamp), status.error_code || '', status.error_message || '', status.elapsed || 0, status.credit_count || 0
        ]);

      } catch (error) {
        let errorText = 'ERROR';
        let logMsg = '';
        const symbolDisplay = rows[i][1] || 'UNKNOWN';
        const statusCode = error.message;

        if (statusCode === '429') {
          errorText = 'RATE LIMIT';
          logMsg = `\x1b[1;31m[!] HTTP 429 | ❌ ${errorText.padEnd(11)} | ${symbolDisplay.padEnd(8)} : ${address} (หยุดรอ 65 วินาทีเพื่อลองใหม่)\x1b[0m`;
        } else if (statusCode === '404') {
          errorText = 'NOT FOUND';
          logMsg = `\x1b[33m[!] HTTP 404 | 🔍 ${errorText.padEnd(11)} | ${symbolDisplay.padEnd(8)} : ${address}\x1b[0m`;
        } else {
          logMsg = `[!] HTTP ${statusCode} | ⚠️ ${errorText.padEnd(11)} | ${symbolDisplay.padEnd(8)} : ${address}`;
        }

        // ล้างบรรทัด Progress Bar ก่อนแล้วค่อยพิมพ์ Log (รองรับกรณีรันบน GitHub Actions ที่ไม่ใช่ TTY)
        if (process.stdout.isTTY) {
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
        }
        console.log(logMsg);

        // จัดการ Rate Limit: รอ 65 วินาที แล้วลองใหม่ (ไม่ข้ามรายการนี้)
        if (statusCode === '429') {
          await delay(65000);
          i--; // ถอยอินเด็กซ์กลับเพื่อดึงข้อมูลรายการเดิมอีกครั้งในรอบถัดไป
          continue; 
        }

        // กรณีเป็น Error อื่น ๆ จะเก็บสถิติว่าพลาดและข้ามไปทำรายการถัดไป
        errorCount++;

        // เขียนลงชีต โดยระบุ Error Code ชัดเจน
        const errorRow = new Array(HEADERS.length).fill('');
        errorRow[0] = `Error HTTP ${statusCode}`;
        errorRow[2] = address;
        errorRow[3] = platform;
        results.push(errorRow);
      }

      progressBar.update(i + 1); 
      await delay(1000); // เพิ่ม Default Delay เป็น 1 วิ ลดโอกาสเจอ Rate Limit
    }

    progressBar.stop();
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n🧹 กำลังเคลียร์ข้อมูลเก่าใน tokensDetail...`);
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'tokensDetail!A:ZZ',
    });

    console.log(`📝 กำลังเขียนข้อมูลใหม่ลงชีต...`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'tokensDetail!A1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: results },
    });

    console.log(`\n✅ อัปเดตข้อมูล ${rows.length} รายการ เสร็จสมบูรณ์!`);
    console.log(`⏱️  ใช้เวลาไปทั้งหมด: ${elapsedTime} วินาที`);
    if (errorCount > 0) {
      console.log(`⚠️  มีข้อมูลที่ไม่พบหรือ Error ทั่วไป: ${errorCount} รายการ (ไม่รวม 429)`);
    }

  } catch (err) {
    console.error('\nเกิดข้อผิดพลาดรุนแรง:', err);
    process.exit(1);
  }
}

main();