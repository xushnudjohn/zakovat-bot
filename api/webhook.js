bash
cat /home/claude/zakovat-bot/api/webhook.js
Output
// ============================================================
//  ZAKOVAT IDENTIFIKATSIYA BOT — Vercel Serverless Function
//
//  Telegram bot — Google Sheets CSV dan ma'lumot o'qiydi
//  Server kerak emas, Vercel bepul hostlaydi
// ============================================================

// Sozlamalar environment variables dan olinadi (Vercel dashboardda kiritasiz)
const BOT_TOKEN = process.env.BOT_TOKEN;
const CSV_URL = process.env.CSV_URL;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;


// ── Telegram ga xabar yuborish ──
async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "MarkdownV2"
    })
  });
}


// ── MarkdownV2 escape ──
function esc(text) {
  if (!text) return '';
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}


// ── CSV parser ──
function parseCSVLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ''; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}


// ── Timestamp parser: "14.03.2026 18:49:04" → Date ──
function parseTimestamp(ts) {
  if (!ts) return new Date(0);
  const parts = ts.match(/(\d+)[.\/](\d+)[.\/](\d+)\s+(\d+):(\d+):?(\d*)/);
  if (!parts) return new Date(0);

  let day, month, year;
  if (parseInt(parts[1]) > 12) {
    day = parseInt(parts[1]);
    month = parseInt(parts[2]) - 1;
    year = parseInt(parts[3]);
  } else if (parseInt(parts[2]) > 12) {
    month = parseInt(parts[1]) - 1;
    day = parseInt(parts[2]);
    year = parseInt(parts[3]);
  } else {
    day = parseInt(parts[1]);
    month = parseInt(parts[2]) - 1;
    year = parseInt(parts[3]);
  }

  return new Date(year, month, day, parseInt(parts[4]), parseInt(parts[5]), parseInt(parts[6] || '0'));
}


// ── CSV dan e-mailni qidirish ──
function findEmail(csv, email) {
  const results = [];
  const lines = csv.split('\n');

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 5) continue;

    const timestamp = (cols[0] || '').trim();
    const team = (cols[1] || '').trim();
    const league = (cols[2] || '').trim();
    if (!team) continue;

    const parsedDate = parseTimestamp(timestamp);

    for (let j = 3; j < cols.length; j += 2) {
      const name = (cols[j] || '').trim();
      const cellEmail = (cols[j + 1] || '').trim().toLowerCase();

      if (cellEmail === email && name) {
        results.push({ team, league, name, email: cellEmail, timestamp, date: parsedDate });
      }
    }
  }

  return results;
}


// ── E-mail tekshirish va javob yuborish ──
async function handleEmailCheck(chatId, email) {
  try {
    const response = await fetch(CSV_URL);

    if (!response.ok) {
      await sendMessage(chatId, "❌ Ma’lumotlar bazasiga ulanib bo‘lmadi\\. Keyinroq urinib ko‘ring\\.");
      return;
    }

    const csv = await response.text();
    const matches = findEmail(csv, email);

    if (matches.length === 0) {
      await sendMessage(chatId,
        "❌ *Identifikatsiyadan o‘tmagan*\n\n" +
        "`" + esc(email) + "`" +
        " E\\-mail manzili ro‘yxatda topilmadi\\.\n\n" +
        "Bu E\\-maildan yuborilgan apellyatsiyalar ko‘rib chiqilmaydi\\.\n" +
        "Quyidagi havola orqali identifikatsiya arizasini yuboring: https://forms.gle/yL7QkmTNFS2y8uwq6 \\."
      );
      return;
    }

    // Sanasi bo'yicha tartiblash (yangi → eski)
    matches.sort((a, b) => b.date - a.date);
    const latest = matches[0];

    let msg =
      "✅ *Identifikatsiyadan o‘tgan*\n\n" +
      "👤 *Ism\\-sharif:* " + esc(latest.name) + "\n" +
      "🏆 *Jamoa:* " + esc(latest.team) + " \\(aktual\\)\n" +
      "🏅 *Liga:* " + esc(latest.league) + "\n" +
      "📧 *E\\-mail:* `" + esc(latest.email) + "`\n" +
      "📅 *Ariza sanasi:* " + esc(latest.timestamp);

    if (matches.length > 1) {
      msg += "\n\n📋 *Arizalar tarixi \\(" + matches.length + " ta\\):*\n";

      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const marker = (i === 0) ? " ◀️" : "";
        msg += "\n" + esc(m.timestamp) + " — " +
               esc(m.team) + " \\(" + esc(m.league) + "\\)" + marker;
      }
    }

    await sendMessage(chatId, msg);

  } catch (err) {
    console.error("handleEmailCheck xatolik:", err);
    await sendMessage(chatId, "⚠️ Xatolik yuz berdi\\. Keyinroq urinib ko‘ring\\.");
  }
}


// ── Asosiy webhook handler ──
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Zakovat Bot is running!");
  }

  try {
    const update = req.body;

    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (text === "/start") {
        await sendMessage(chatId,
          "👋 *Zakovat Identifikatsiya Tekshiruvi*\n\n" +
          "Apellyatsiya yuborishdan avval e\\-mail manzilingiz identifikatsiyadan o‘tganligini tekshiring\\.\n\n" +
          "📩 E\\-mail manzilingizni yuboring — men tekshirib beraman\\."
        );
      }
      else if (text === "/help") {
        await sendMessage(chatId,
          "ℹ️ *Qanday ishlaydi?*\n\n" +
          "1\\. E\\-mail manzilingizni yozing\n" +
          "2\\. Bot identifikatsiya holatini tekshiradi\n" +
          "3\\. Natija ism\\-sharif, jamoa va liga bilan chiqadi\n\n" +
          "⚠️ Apellyatsiya faqat identifikatsiyadan o‘tgan e\\-mail orqali yuborilganda ko‘rib chiqiladi\\."
        );
      }
      else if (text.includes("@") && text.includes(".")) {
        await handleEmailCheck(chatId, text.toLowerCase().trim());
      }
      else {
        await sendMessage(chatId,
          "📩 Iltimos, e\\-mail manzilingizni yuboring\\.\n\nMasalan: `bilimdon@gmail\\.com`"
        );
      }
    }
  } catch (err) {
    console.error("Webhook xatolik:", err);
  }

  res.status(200).send("OK");
}
