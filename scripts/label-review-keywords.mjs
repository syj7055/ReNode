import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv from "ajv";

const DEFAULT_INPUT = path.resolve("resources/reviews_preprocessed.csv");
const DEFAULT_CACHE = path.resolve("resources/ai_keyword_cache.json");

const ALLOWED_KEYWORDS = [
  "혼밥",
  "주차가능",
  "단체석",
  "예약편리",
  "대화하기좋은",
  "가성비",
  "친절한",
  "청결한",
];

const KEYWORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["keywords"],
  properties: {
    keywords: {
      type: "array",
      items: {
        type: "string",
        enum: ALLOWED_KEYWORDS,
      },
      uniqueItems: true,
      maxItems: 6,
    },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validateKeywordPayload = ajv.compile(KEYWORD_SCHEMA);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeWhitespace = (value) =>
  String(value || "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeReviewText = (value) => normalizeWhitespace(String(value || "").replace(/접기/g, ""));

const splitTagList = (value) => {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      String(value)
        .split(/[|,]/)
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean)
    )
  );
};

const hashReviewText = (text) => createHash("sha256").update(text).digest("hex");

const parseCsv = (csvText) => {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const text = String(csvText || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const escapeCsvField = (value) => {
  const raw = String(value ?? "");
  const needsQuotes = /[",\n\r]/.test(raw);
  if (!needsQuotes) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
};

const stringifyCsv = (rows) => rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");

const parseArgs = (argv) => {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_INPUT,
    cache: DEFAULT_CACHE,
    model: "gpt-4.1-mini",
    from: 0,
    limit: Number.POSITIVE_INFINITY,
    saveEvery: 30,
    force: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--input") {
      options.input = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--output") {
      options.output = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--cache") {
      options.cache = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--model") {
      options.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--from") {
      options.from = Number.parseInt(argv[i + 1], 10) || 0;
      i += 1;
      continue;
    }
    if (token === "--limit") {
      const parsed = Number.parseInt(argv[i + 1], 10);
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
      i += 1;
      continue;
    }
    if (token === "--save-every") {
      const parsed = Number.parseInt(argv[i + 1], 10);
      options.saveEvery = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
      i += 1;
      continue;
    }
    if (token === "--force") {
      options.force = true;
      continue;
    }
    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
  }

  return options;
};

const loadCache = async (cachePath) => {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.keywordsByHash && typeof parsed.keywordsByHash === "object") {
      return parsed;
    }
  } catch {
    // ignore
  }

  return {
    version: 1,
    updatedAt: null,
    keywordsByHash: {},
  };
};

const saveCache = async (cachePath, cache) => {
  const next = {
    ...cache,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(next, null, 2), "utf8");
};

const classifyReviewKeywords = async ({ apiKey, model, reviewText }) => {
  const systemPrompt = [
    "너는 한국어 리뷰 키워드 라벨러다.",
    "반드시 JSON만 출력해야 하며 허용된 키워드만 선택한다.",
    "리뷰에 근거가 없으면 빈 배열을 반환한다.",
    `허용 키워드: ${ALLOWED_KEYWORDS.join(", ")}`,
  ].join("\n");

  const userPrompt = [
    "아래 리뷰에서 해당되는 키워드만 골라라.",
    "중복 없이 반환하고, 확신이 없으면 제외한다.",
    "리뷰:",
    reviewText,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "review_keywords",
          strict: true,
          schema: KEYWORD_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Model response is empty or non-string.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON from model: ${error.message}`);
  }

  if (!validateKeywordPayload(parsed)) {
    throw new Error(`Schema validation failed: ${ajv.errorsText(validateKeywordPayload.errors)}`);
  }

  return parsed.keywords;
};

const classifyWithRetry = async ({ apiKey, model, reviewText, attempts = 3 }) => {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await classifyReviewKeywords({ apiKey, model, reviewText });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(attempt * 800);
      }
    }
  }

  throw lastError;
};

const ensureRowWidth = (row, width) => {
  while (row.length < width) {
    row.push("");
  }
};

const writeCsvOutput = async ({ outputPath, inputPath, sourceCsvText, rows }) => {
  const resolvedOutput = path.resolve(outputPath);
  const resolvedInput = path.resolve(inputPath);

  if (resolvedOutput === resolvedInput) {
    const backupPath = `${resolvedInput}.bak`;
    await fs.writeFile(backupPath, sourceCsvText, "utf8");
    console.log(`[backup] ${backupPath}`);
  }

  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, stringifyCsv(rows), "utf8");
  console.log(`[output] ${resolvedOutput}`);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 환경변수가 필요합니다.");
  }

  const sourceCsvText = await fs.readFile(options.input, "utf8");
  const table = parseCsv(sourceCsvText);

  if (table.length === 0) {
    throw new Error("CSV 파일이 비어 있습니다.");
  }

  const header = table[0];
  const rows = table.slice(1);

  const reviewTextIndex = header.indexOf("review_text");
  if (reviewTextIndex === -1) {
    throw new Error("CSV 헤더에 review_text 컬럼이 없습니다.");
  }

  let aiKeywordIndex = header.indexOf("ai_keywords");
  if (aiKeywordIndex === -1) {
    header.push("ai_keywords");
    aiKeywordIndex = header.length - 1;
  }

  rows.forEach((row) => ensureRowWidth(row, header.length));

  const start = Math.max(0, options.from);
  const end = Number.isFinite(options.limit)
    ? Math.min(rows.length, start + options.limit)
    : rows.length;

  const cache = await loadCache(options.cache);
  const keywordsByHash = cache.keywordsByHash;

  let apiCalls = 0;
  let cacheHits = 0;
  let updated = 0;
  let skippedExisting = 0;
  let skippedEmpty = 0;

  console.log(`[config] model=${options.model}`);
  console.log(`[config] input=${path.resolve(options.input)}`);
  console.log(`[config] output=${path.resolve(options.output)}`);
  console.log(`[config] range=${start}..${end - 1}`);

  for (let i = start; i < end; i += 1) {
    const row = rows[i];
    const existingKeywords = splitTagList(row[aiKeywordIndex]);

    if (existingKeywords.length > 0 && !options.force) {
      skippedExisting += 1;
      continue;
    }

    const reviewText = normalizeReviewText(row[reviewTextIndex]);
    if (!reviewText) {
      row[aiKeywordIndex] = "";
      skippedEmpty += 1;
      continue;
    }

    const reviewHash = hashReviewText(reviewText);
    let keywords;

    if (Array.isArray(keywordsByHash[reviewHash]?.keywords) && !options.force) {
      keywords = keywordsByHash[reviewHash].keywords;
      cacheHits += 1;
    } else {
      keywords = await classifyWithRetry({
        apiKey,
        model: options.model,
        reviewText,
      });
      keywordsByHash[reviewHash] = {
        keywords,
        updatedAt: new Date().toISOString(),
      };
      apiCalls += 1;
    }

    row[aiKeywordIndex] = keywords.join("|");
    updated += 1;

    if (updated % options.saveEvery === 0) {
      await saveCache(options.cache, cache);
    }

    if ((i - start + 1) % 20 === 0) {
      console.log(`[progress] ${i + 1 - start}/${end - start} rows processed`);
    }
  }

  await saveCache(options.cache, cache);

  const outputRows = [header, ...rows];
  if (!options.dryRun) {
    await writeCsvOutput({
      outputPath: options.output,
      inputPath: options.input,
      sourceCsvText,
      rows: outputRows,
    });
  }

  console.log("[done] keyword labeling completed");
  console.log(`[stats] updated=${updated}`);
  console.log(`[stats] apiCalls=${apiCalls}`);
  console.log(`[stats] cacheHits=${cacheHits}`);
  console.log(`[stats] skippedExisting=${skippedExisting}`);
  console.log(`[stats] skippedEmpty=${skippedEmpty}`);
  if (options.dryRun) {
    console.log("[dry-run] output file was not written");
  }
};

main().catch((error) => {
  console.error(`[error] ${error.message}`);
  process.exit(1);
});
