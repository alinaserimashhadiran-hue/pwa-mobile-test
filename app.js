/* منطق آزمایشی PWA v2 — IndexedDB پایدار + وضعیت LNA دقیق */

const DB_NAME = "pwa-prototype-db";
const DB_VERSION = 1;
const STORE = "files";

const logEl = document.getElementById("log");
const serverInput = document.getElementById("server-url");
const btnTest = document.getElementById("btn-test");
const btnDownload = document.getElementById("btn-download");
const btnPlayStored = document.getElementById("btn-play-stored");
const btnDelete = document.getElementById("btn-delete");
const btnClear = document.getElementById("btn-clear");
const downloadResult = document.getElementById("download-result");
const player = document.getElementById("player");

let currentObjectUrl = null;

function log(msg) {
  const time = new Date().toLocaleTimeString("fa-IR");
  logEl.textContent += `[${time}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
}

function setStatus(id, state, text) {
  const dot = document.getElementById(id + "-dot");
  const txt = document.getElementById(id + "-text");
  if (!dot || !txt) return;
  const map = { ok: "ok", fail: "fail", warn: "warn", unknown: "unknown" };
  dot.className = "dot " + (map[state] || "unknown");
  txt.textContent = text;
}

/* ——— IndexedDB ——— */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveFile(id, blob, meta) {
  meta = meta || {};
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      id: id,
      blob: blob,
      mime: blob.type || meta.mime || "application/octet-stream",
      size: blob.size,
      savedAt: Date.now(),
      source: meta.source || ""
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getFile(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteFile(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function revokeCurrentUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

async function refreshStoredUi() {
  try {
    const rec = await getFile("test-audio");
    if (rec && rec.blob) {
      const when = new Date(rec.savedAt).toLocaleString("fa-IR");
      downloadResult.textContent =
        "فایل در IndexedDB موجود است — " +
        (rec.size / 1024).toFixed(1) +
        " KB — " +
        when;
      btnPlayStored.disabled = false;
      btnDelete.disabled = false;
    } else {
      downloadResult.textContent = "هیچ فایل ذخیره‌شده‌ای در IndexedDB نیست.";
      btnPlayStored.disabled = true;
      btnDelete.disabled = true;
      player.classList.add("hidden");
      player.removeAttribute("src");
      revokeCurrentUrl();
    }
  } catch (e) {
    downloadResult.textContent = "خطا در خواندن IndexedDB: " + (e.message || e);
  }
}

/* ——— محیط ——— */
function checkEnvironment() {
  if (window.isSecureContext) {
    setStatus("secure", "ok", "Secure Context: بله");
  } else {
    setStatus("secure", "fail", "Secure Context: خیر");
  }

  function updateOnline() {
    setStatus(
      "online",
      navigator.onLine ? "ok" : "warn",
      navigator.onLine ? "اتصال اینترنت: آنلاین" : "اتصال اینترنت: آفلاین"
    );
  }
  updateOnline();
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .then(function (reg) {
        setStatus("sw", "ok", "Service Worker: ثبت شد");
        log("Service Worker ثبت شد. scope: " + reg.scope);
      })
      .catch(function (err) {
        setStatus("sw", "fail", "Service Worker: خطا");
        log("خطا در ثبت SW: " + err.message);
      });
  } else {
    setStatus("sw", "fail", "Service Worker: پشتیبانی نمی‌شود");
  }

  // تا قبل از درخواست واقعی ادعای مجوز نکن
  setStatus("lna", "unknown", "Local Network Access: هنوز آزمایش نشده");
}

/* ——— اتصال ——— */
async function testConnection() {
  var base = serverInput.value.trim().replace(/\/$/, "");
  if (!base) {
    log("آدرس Mobile Server را وارد کنید.");
    return;
  }
  if (base.indexOf("http://") !== 0 && base.indexOf("https://") !== 0) {
    log("آدرس باید با http:// یا https:// شروع شود.");
    return;
  }

  log("تست اتصال به " + base + "/api/ping ...");
  btnTest.disabled = true;
  setStatus("lna", "unknown", "Local Network Access: در حال درخواست...");

  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, 10000);

  try {
    var fetchOpts = {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: controller.signal
    };
    try {
      fetchOpts.targetAddressSpace = "local";
    } catch (e) {}

    var res = await fetch(base + "/api/ping", fetchOpts);
    clearTimeout(timer);

    if (!res.ok) throw new Error("HTTP " + res.status);
    var data = await res.json();
    log("پاسخ سرور: " + JSON.stringify(data));

    // فقط موفقیت ارتباط را گزارش می‌کنیم؛ ادعای «مجوز رسمی LNA» نمی‌کنیم
    setStatus("lna", "ok", "ارتباط با سرور محلی برقرار شد");
    btnDownload.disabled = false;
    localStorage.setItem("ms_base", base);
  } catch (err) {
    clearTimeout(timer);
    var name = err && err.name ? err.name : "";
    var msg = err && err.message ? err.message : String(err);

    if (name === "AbortError") {
      log("خطا: زمان اتصال تمام شد (timeout ۱۰ ثانیه).");
    } else {
      log("خطا در ارتباط: " + msg);
    }

    setStatus("lna", "fail", "ارتباط با سرور محلی برقرار نشد");

    if (!window.isSecureContext) {
      log("راهنما: صفحه Secure Context نیست. از GitHub Pages (HTTPS) استفاده کنید.");
    } else {
      log(
        "راهنما: ۱) Mobile Server روشن و روی همان Wi-Fi باشد. ۲) اگر پنجره مجوز شبکه محلی ظاهر شد تأیید کنید. ۳) IP و پورت را بررسی کنید."
      );
    }
    btnDownload.disabled = true;
  } finally {
    btnTest.disabled = false;
  }
}

/* ——— دانلود و ذخیره ——— */
async function downloadTestFile() {
  var base =
    serverInput.value.trim().replace(/\/$/, "") ||
    localStorage.getItem("ms_base");
  if (!base) {
    log("آدرس سرور مشخص نیست.");
    return;
  }

  log("شروع دانلود فایل آزمایشی...");
  btnDownload.disabled = true;

  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, 30000);

  try {
    var res = await fetch(base + "/api/test-file", {
      mode: "cors",
      cache: "no-store",
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error("HTTP " + res.status);

    var blob = await res.blob();
    log(
      "دانلود شد: " +
        (blob.size / 1024).toFixed(1) +
        " KB — نوع: " +
        (blob.type || "نامشخص")
    );

    await saveFile("test-audio", blob, { source: base + "/api/test-file" });
    log("فایل در IndexedDB ذخیره شد (کلید: test-audio).");

    await refreshStoredUi();
    await playStored();
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      log("خطا: زمان دانلود تمام شد.");
    } else {
      log("خطا در دانلود: " + (err && err.message ? err.message : err));
    }
  } finally {
    btnDownload.disabled = false;
  }
}

async function playStored() {
  var rec = await getFile("test-audio");
  if (!rec || !rec.blob) {
    log("فایلی برای پخش وجود ندارد.");
    return;
  }
  revokeCurrentUrl();
  currentObjectUrl = URL.createObjectURL(rec.blob);
  player.src = currentObjectUrl;
  player.classList.remove("hidden");
  try {
    await player.play();
    log("پخش از IndexedDB شروع شد.");
  } catch (e) {
    log("پخش خودکار ممکن نشد. دکمه پخش پلیر را بزنید.");
  }
}

async function removeStored() {
  await deleteFile("test-audio");
  revokeCurrentUrl();
  player.classList.add("hidden");
  player.removeAttribute("src");
  log("فایل از IndexedDB حذف شد.");
  await refreshStoredUi();
}

/* ——— رویدادها ——— */
btnTest.addEventListener("click", testConnection);
btnDownload.addEventListener("click", downloadTestFile);
btnPlayStored.addEventListener("click", playStored);
btnDelete.addEventListener("click", removeStored);
btnClear.addEventListener("click", function () {
  logEl.textContent = "";
});

var saved = localStorage.getItem("ms_base");
if (saved) serverInput.value = saved;

checkEnvironment();
refreshStoredUi().then(function () {
  log("آماده. وضعیت فایل ذخیره‌شده بررسی شد.");
});
