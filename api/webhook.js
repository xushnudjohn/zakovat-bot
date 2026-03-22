const BOT_TOKEN = process.env.BOT_TOKEN;
const CSV_URL = process.env.CSV_URL;
const TELEGRAM_API = "https://api.telegram.org/bot" + BOT_TOKEN;

async function sendMessage(chatId, text) {
  await fetch(TELEGRAM_API + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "MarkdownV2"
    })
  });
}

function esc(text) {
  if (!text) return "";
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function parseCSVLine(line) {
  var result = [];
  var current = "", inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function parseTimestamp(ts) {
  if (!ts) return new Date(0);
  var parts = ts.match(/(\d+)[.\/](\d+)[.\/](\d+)\s+(\d+):(\d+):?(\d*)/);
  if (!parts) return new Date(0);
  var a = parseInt(parts[1]), b = parseInt(parts[2]), y = parseInt(parts[3]);
  var day, month;
  if (a > 12) { day = a; month = b - 1; }
  else if (b > 12) { month = a - 1; day = b; }
  else { day = a; month = b - 1; }
  return new Date(y, month, day, parseInt(parts[4]), parseInt(parts[5]), parseInt(parts[6] || "0"));
}

function findEmail(csv, email) {
  var results = [];
  var lines = csv.split("\n");
  for (var i = 1; i < lines.length; i++) {
    var cols = parseCSVLine(lines[i]);
    if (cols.length < 5) continue;
    var timestamp = (cols[0] || "").trim();
    var team = (cols[1] || "").trim();
    var league = (cols[2] || "").trim();
    if (!team) continue;
    var parsedDate = parseTimestamp(timestamp);
    for (var j = 3; j < cols.length; j += 2) {
      var name = (cols[j] || "").trim();
      var cellEmail = (cols[j + 1] || "").trim().toLowerCase();
      if (cellEmail === email && name) {
        results.push({ team: team, league: league, name: name, email: cellEmail, timestamp: timestamp, date: parsedDate });
      }
    }
  }
  return results;
}

async function handleEmailCheck(chatId, email) {
  try {
    var response = await fetch(CSV_URL);
    if (!response.ok) {
      await sendMessage(chatId, esc("Ma'lumotlar bazasiga ulanib bo'lmadi. Keyinroq urinib ko'ring."));
      return;
    }
    var csv = await response.text();
    var matches = findEmail(csv, email);

    if (matches.length === 0) {
      var notFound =
        "*" + esc("❌ Identifikatsiyadan o'tmagan") + "*" + "\n\n" +
        "`" + esc(email) + "`" +
        " " + esc("e-mail manzili ro'yxatda topilmadi.") + "\n\n" +
        esc("Bu e-maildan yuborilgan apellyatsiyalar ko'rib chiqilmaydi.") + "\n" +
        esc("Jamoangiz kapitani orqali identifikatsiya formasini to'ldiring.");
      await sendMessage(chatId, notFound);
      return;
    }

    matches.sort(function(a, b) { return b.date - a.date; });

    // Har bir jamoa nomidan faqat eng oxirgi arizani qoldirish
    var seen = {};
    var unique = [];
    for (var u = 0; u < matches.length; u++) {
      var key = matches[u].team + "||" + matches[u].league;
      if (!seen[key]) {
        seen[key] = true;
        unique.push(matches[u]);
      }
    }
    matches = unique;

    var latest = matches[0];

    var msg =
      "*" + esc("✅ Identifikatsiyadan o'tgan") + "*" + "\n\n" +
      "*" + esc("👤 Ism-sharif:") + "*" + " " + esc(latest.name) + "\n" +
      "*" + esc("🏆 Jamoa:") + "*" + " " + esc(latest.team) + " " + esc("(aktual)") + "\n" +
      "*" + esc("🏅 Liga:") + "*" + " " + esc(latest.league) + "\n" +
      "*" + esc("📧 E-mail:") + "*" + " " + "`" + esc(latest.email) + "`" + "\n" +
      "*" + esc("📅 Ariza sanasi:") + "*" + " " + esc(latest.timestamp);

    if (matches.length > 1) {
      msg += "\n\n*" + esc("📋 Arizalar tarixi (" + matches.length + " ta):") + "*" + "\n";
      for (var k = 0; k < matches.length; k++) {
        var m = matches[k];
        var marker = (k === 0) ? " ◀️" : "";
        msg += "\n" + esc(m.timestamp + " — " + m.team + " (" + m.league + ")") + marker;
      }
    }

    await sendMessage(chatId, msg);
  } catch (err) {
    console.error("handleEmailCheck xatolik:", err);
    await sendMessage(chatId, esc("Xatolik yuz berdi. Keyinroq urinib ko'ring."));
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Zakovat Bot is running!");
  }

  try {
    var update = req.body;

    if (update.message && update.message.text) {
      var chatId = update.message.chat.id;
      var text = update.message.text.trim();

      if (text === "/start") {
        await sendMessage(chatId,
          esc("👋 Zakovat Identifikatsiya Tekshiruvi") + "\n\n" +
          esc("Apellyatsiya yuborishdan avval e-mail manzilingiz identifikatsiyadan o'tganligini tekshiring.") + "\n\n" +
          esc("📩 E-mail manzilingizni yuboring — men tekshirib beraman.")
        );
      }
      else if (text === "/help") {
        await sendMessage(chatId,
          esc("ℹ️ Qanday ishlaydi?") + "\n\n" +
          esc("1. E-mail manzilingizni yozing") + "\n" +
          esc("2. Bot identifikatsiya holatini tekshiradi") + "\n" +
          esc("3. Natija ism-sharif, jamoa va liga bilan chiqadi") + "\n\n" +
          esc("⚠️ Apellyatsiya faqat identifikatsiyadan o'tgan e-mail orqali yuborilganda ko'rib chiqiladi.")
        );
      }
      else if (text.indexOf("@") !== -1 && text.indexOf(".") !== -1) {
        await handleEmailCheck(chatId, text.toLowerCase().trim());
      }
      else {
        await sendMessage(chatId,
          esc("📩 Iltimos, e-mail manzilingizni yuboring.") + "\n\n" +
          esc("Masalan: ") + "`bilimdon@gmail\\.com`"
        );
      }
    }
  } catch (err) {
    console.error("Webhook xatolik:", err);
  }

  res.status(200).send("OK");
};
