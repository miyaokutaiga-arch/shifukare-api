import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const allowedOrigins = [
  "https://shifukare.com",
  "https://www.shifukare.com",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS not allowed: ${origin}`));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "1mb" }));

function normalizeDateToSlash(dateStr) {
  if (!dateStr || dateStr === "未設定") return "未設定";
  return String(dateStr).replace(/-/g, "/");
}

function normalizeTimeRange(startTime, endTime) {
  const invalidStart = !startTime || startTime === "未設定";
  const invalidEnd = !endTime || endTime === "未設定";

  if (invalidStart && invalidEnd) return "未設定";
  if (!invalidStart && !invalidEnd) return `${startTime}〜${endTime}`;
  if (!invalidStart) return `${startTime}〜未設定`;
  return "未設定";
}

function normalizeSchedule(item, rawText) {
  return {
    title: item?.title || "予定",
    date: normalizeDateToSlash(item?.date || "未設定"),
    time: normalizeTimeRange(item?.startTime, item?.endTime),
    location: item?.location || "未設定",
    type: item?.type || "予定",
    reason: item?.reason || "",
    rawText,
  };
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "shifukare-api",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/parse-schedule", async (req, res) => {
  try {
    const { text } = req.body ?? {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const prompt = `
あなたは日本語の予定抽出アシスタントです。
入力文から予定情報を抽出し、必ずJSONだけを返してください。
説明文、コードブロック、前置きは不要です。

返すJSONの形式:
{
  "schedules": [
    {
      "title": "予定名",
      "date": "YYYY-MM-DD または 未設定",
      "startTime": "HH:MM または 未設定",
      "endTime": "HH:MM または 未設定",
      "location": "場所 または 未設定",
      "type": "面接|シフト|授業|予定",
      "reason": "50文字以内の簡単な補足"
    }
  ]
}

ルール:
- 予定が複数あれば、すべて schedules 配列に入れる
- 予定が1件でも schedules 配列で返す
- 予定が見つからない場合も schedules は空配列ではなく、できるだけ1件推定して返す
- 予定名は自然な日本語にする
- 種類は 面接 / シフト / 授業 / 予定 のどれか
- 時間が1つしか分からない場合は startTime のみに入れる
- 「1限」「2限」などの時限表現は、大学ごとに異なる可能性があるため固定の時刻に変換しない
- 時刻が不明で「2限」などしか書かれていない場合は、startTime と endTime は 未設定 にする
- 必要なら reason に「2限表記のため時刻未設定」のように短く補足する
- 不明な項目は 未設定
- JSONとして正しい形式で返す

入力文:
${text}
`.trim();

    const response = await client.responses.create({
      model: "gpt-5.4",
      input: prompt,
    });

    const raw = response.output_text?.trim() || "";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("AI raw output was not valid JSON:");
      console.error(raw);
      return res.status(500).json({
        error: "AI response was not valid JSON",
        raw,
      });
    }

    const schedules = Array.isArray(parsed?.schedules) ? parsed.schedules : [];
    const normalized = schedules.map((item) => normalizeSchedule(item, text));

    return res.json({
      schedules: normalized,
    });
  } catch (error) {
    console.error("parse-schedule error:", error);
    return res.status(500).json({
      error: "Failed to parse schedule",
      detail: error?.message || "Unknown error",
    });
  }
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    detail: err?.message || "Unknown error",
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
