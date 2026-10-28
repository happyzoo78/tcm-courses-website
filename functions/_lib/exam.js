// 模擬考題：把貼上的文字拆成題目、自動批改、整理統計
// 題目整份存成 JSON；同學作答時只拿得到「沒有答案」的版本，答案只在伺服器批改

export const TYPE_NAME = { single: "單選題", multi: "多選題", tf: "是非題", fill: "填空題", essay: "申論題" };
export const MAX_SOURCE = 300_000;      // 貼上的文字上限（約 15 萬字）
export const MAX_QUESTIONS = 300;
const MAX_ESSAY_TEXT = 5000;

const HEADINGS = [
  [/共用|B1|配伍/i, "group"],
  [/多選|多选|X\s*型/i, "multi"],
  [/單選|单选|選擇題|选择题|A1|A2|最佳/i, "single"],
  [/是非|判斷|判断|對錯|对错/, "tf"],
  [/填空/, "fill"],
  [/申論|申论|問答|问答|簡答|简答|論述|论述|名詞解釋|名词解释/, "essay"]
];

const RE = {
  heading: /^\s*(?:#{1,6}\s*(.+)|([一二三四五六七八九十]+\s*[、.．]\s*.*題.*))$/,
  question: /^\s*(\d{1,3})\s*[.．、)）]\s*(.*)$/,
  option: /^\s*([A-Ha-hＡ-Ｈａ-ｈ])\s*[.．、)）:：]\s*(.*)$/,
  answer: /^\s*(?:正確答案|正确答案|標準答案|标准答案|答案)\s*[:：]\s*(.*)$/,
  explain: /^\s*(?:解析|詳解|详解|說明|说明)\s*[:：]\s*(.*)$/,
  reference: /^\s*(?:參考答案|参考答案|範例答案|范例答案)\s*[:：]\s*(.*)$/,
  rubric: /^\s*(?:評分要點|评分要点|得分要點|得分要点)\s*[:：]\s*(.*)$/,
  points: /^\s*(?:配分|分數|分数|分值)\s*[:：]\s*(\d+(?:\.\d+)?)\s*分?\s*$/,
  groupStart: /^\s*(?:\[\s*(?:共用)?選項\s*\]|\[\s*(?:共用)?选项\s*\]|共用選項\s*[:：]?|共用选项\s*[:：]?|共用備選答案\s*[:：]?|共用备选答案\s*[:：]?)\s*$/,
  groupEnd: /^\s*\[\s*\/\s*(?:共用)?(?:選項|选项)\s*\]\s*$/,
  perPoints: /每題\s*(\d+(?:\.\d+)?)\s*分|每题\s*(\d+(?:\.\d+)?)\s*分/,
  blank: /_{2,}|＿{1,}|（\s*）|\(\s*\)/g
};

const TRUE_WORDS = ["對", "对", "是", "正確", "正确", "o", "○", "✓", "✔", "v", "t", "true", "√"];
const FALSE_WORDS = ["錯", "错", "否", "錯誤", "错误", "x", "×", "✗", "✘", "f", "false"];

const letter = s => String(s).normalize("NFKC").trim().toUpperCase();
const norm = s => String(s ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();

// 一行裡有好幾個選項時拆開，例如「A.心 B.肝 C.脾」
function splitOptions(text) {
  const parts = [];
  const re = /(?:^|\s)([A-Ha-hＡ-Ｈａ-ｈ])\s*[.．、)）:：]\s*/g;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ key: letter(m[1]), start: m.index, end: re.lastIndex });
  // 只有字母連續（A、B、C…）才當成同一行的多個選項
  const ok = marks.length > 1 && marks.every((x, i) => i === 0 || x.key.charCodeAt(0) === marks[i - 1].key.charCodeAt(0) + 1);
  if (!ok) return null;
  marks.forEach((x, i) => parts.push({ key: x.key, text: text.slice(x.end, i + 1 < marks.length ? marks[i + 1].start : undefined).trim() }));
  return parts;
}

export function parseExam(source) {
  const errors = [];
  const questions = [];
  const groups = [];
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  if (String(source || "").length > MAX_SOURCE) return { questions, groups, errors: [{ message: "內容太長，請分成兩份考卷。" }] };

  let section = null, sectionPoints = null;
  let q = null;                 // 目前的題目
  let field = null;             // 多行欄位：explanation / reference / rubric / stem
  let lastNo = 0;               // 原文題號（判斷解析裡的數字是不是新題目）
  let group = null;             // 目前的共用選項組
  let groupOpen = false;        // 正在收集共用選項

  const finish = () => {
    if (!q) return;
    for (const k of ["stem", "explanation", "reference", "rubric"]) if (q[k] != null) q[k] = q[k].replace(/\n{3,}/g, "\n\n").trim();
    questions.push(q);
    q = null; field = null;
  };
  const startGroup = () => {
    group = { id: `g${groups.length + 1}`, options: [] };
    groups.push(group);
    groupOpen = true;
  };

  // 解析、參考答案裡出現「1.」「2.」時，往下看到下一個題號前有沒有「答案：」，有才是新題目
  const answerAhead = from => {
    for (let j = from + 1; j < lines.length; j++) {
      if (RE.question.test(lines[j]) || RE.heading.test(lines[j])) return false;
      if (RE.answer.test(lines[j]) || RE.reference.test(lines[j])) return true;
    }
    return false;
  };

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    const lineNo = i + 1;
    let m;

    if (!line.trim()) { if (field && q) q[field] += "\n"; return; }

    // 標題：# 單選題、一、單選題（每題 1 分）
    if ((m = RE.heading.exec(line)) && !(field && /^[一二三四五六七八九十]/.test(line.trim()) && !/題/.test(line))) {
      const text = (m[1] || m[2] || "").trim();
      const found = HEADINGS.find(([re]) => re.test(text));
      if (found || m[1]) {
        finish();
        section = found ? found[1] : null;
        const pp = RE.perPoints.exec(text);
        sectionPoints = pp ? Number(pp[1] || pp[2]) : null;
        group = null; groupOpen = false; lastNo = 0;
        return;
      }
    }

    if (RE.groupStart.test(line)) { finish(); startGroup(); return; }
    if (RE.groupEnd.test(line)) { finish(); group = null; groupOpen = false; return; }

    // 新題目（解析、參考答案裡的「1.」「2.」不會被當成新題）
    if ((m = RE.question.exec(line))) {
      const n = Number(m[1]);
      const inLongField = field && field !== "stem";
      if (!inLongField || answerAhead(i)) {
        finish();
        lastNo = n;
        groupOpen = false;
        q = { no: questions.length + 1, srcNo: n, line: lineNo, section, stem: m[2], options: [], answerRaw: null,
              explanation: null, reference: null, rubric: null, points: null, sectionPoints, group: group ? group.id : null };
        field = "stem";
        return;
      }
    }

    if ((m = RE.answer.exec(line)) && q) {
      if (q.answerRaw != null) errors.push({ no: q.no, line: lineNo, message: `第 ${lineNo} 行出現第二個「答案：」，可能是前面有題目的題號沒被認出來（每題要用「數字.」開頭）。` });
      q.answerRaw = m[1].trim(); field = null; return;
    }
    if ((m = RE.explain.exec(line)) && q) { q.explanation = m[1]; field = "explanation"; return; }
    if ((m = RE.reference.exec(line)) && q) { q.reference = m[1]; field = "reference"; return; }
    if ((m = RE.rubric.exec(line)) && q) { q.rubric = m[1]; field = "rubric"; return; }
    if ((m = RE.points.exec(line)) && q) { q.points = Number(m[1]); field = null; return; }

    // 選項：屬於目前題目；題目已有答案（或還沒有題目）時，就是新的共用選項組
    if ((m = RE.option.exec(line)) && !(field && field !== "stem")) {
      const opts = splitOptions(line.trim()) || [{ key: letter(m[1]), text: m[2].trim() }];
      if (q && q.answerRaw == null && !groupOpen) {
        q.options.push(...opts);
        field = null;
      } else {
        if (q) finish();
        if (!groupOpen) startGroup();
        group.options.push(...opts);
      }
      return;
    }

    // 其他文字：接在目前的欄位後面
    if (q && field) { q[field] += (q[field] ? "\n" : "") + line.trim(); return; }
    if (q && !field && q.answerRaw == null) { q.stem += "\n" + line.trim(); return; }
    if (q) { errors.push({ no: q.no, line: lineNo, message: `第 ${lineNo} 行「${line.trim().slice(0, 20)}」不知道屬於哪個欄位，已忽略。` }); return; }
    errors.push({ line: lineNo, message: `第 ${lineNo} 行「${line.trim().slice(0, 20)}」不在任何題目裡，已忽略。` });
  });
  finish();

  // 決定題型、檢查答案
  const out = questions.map(q => {
    const where = `第 ${q.no} 題（原文題號 ${q.srcNo}，第 ${q.line} 行）`;
    const err = message => errors.push({ no: q.no, line: q.line, message: `${where}：${message}` });
    const grp = q.group && !q.options.length ? groups.find(g => g.id === q.group) : null;
    const options = q.options.length ? q.options : grp ? grp.options : [];
    const keys = options.map(o => o.key);
    if (new Set(keys).size !== keys.length) err("選項字母重複。");
    if (!q.stem.trim()) err("沒有題目內容。");

    let type = q.section === "group" ? "single" : q.section;
    const raw = q.answerRaw;
    const lettersOnly = raw != null && /^[A-Ha-hＡ-Ｈａ-ｈ\s,，、]+$/.test(raw);
    if (!type) {
      if (q.reference != null) type = "essay";
      else if (options.length) type = raw != null && raw.replace(/[\s,，、]/g, "").length > 1 ? "multi" : "single";
      else if (raw != null && [...TRUE_WORDS, ...FALSE_WORDS].includes(norm(raw))) type = "tf";
      else type = "fill";
    }

    const base = { id: `q${q.no}`, no: q.no, type, stem: q.stem.trim(), points: q.points ?? q.sectionPoints ?? (type === "essay" ? 10 : 1),
                   explanation: q.explanation || "", group: grp ? grp.id : null };
    if (!(base.points > 0) || base.points > 100) err("配分要在 0～100 之間。");

    if (type === "single" || type === "multi") {
      if (options.length < 2) err("選擇題至少要有 2 個選項。");
      if (raw == null || !raw.trim()) { err("缺少「答案：」。"); return { ...base, options, answer: null }; }
      const ans = [...new Set(raw.normalize("NFKC").toUpperCase().replace(/[\s,，、]/g, "").split(""))].sort();
      if (!lettersOnly) err(`答案「${raw}」裡有不存在的選項（答案要用選項字母，例如 A 或 ACD）。`);
      else if (ans.some(a => !keys.includes(a))) err(`答案「${raw}」裡有不存在的選項。`);
      if (type === "single" && ans.length !== 1) err(`單選題只能有一個答案（目前是「${raw}」）。`);
      return { ...base, options: grp ? [] : options, answer: type === "single" ? ans[0] : ans };
    }
    if (type === "tf") {
      const v = norm(raw);
      const answer = TRUE_WORDS.includes(v) ? true : FALSE_WORDS.includes(v) ? false : null;
      if (answer === null) err(`是非題答案請寫「對」或「錯」（目前是「${raw ?? "沒有填"}」）。`);
      return { ...base, answer };
    }
    if (type === "fill") {
      if (raw == null || !raw.trim()) { err("缺少「答案：」。"); return { ...base, blanks: 1, answer: [] }; }
      const answer = raw.split(/[；;]/).map(s => s.split(/[\/／｜|]/).map(x => x.trim()).filter(Boolean)).filter(a => a.length);
      const marks = (base.stem.match(RE.blank) || []).length;
      if (marks && marks !== answer.length) err(`題目有 ${marks} 個空格，但答案有 ${answer.length} 個（多個空格的答案請用「；」分開）。`);
      return { ...base, blanks: answer.length || 1, answer };
    }
    // 申論題
    if (!q.reference || !q.reference.trim()) err("申論題需要「參考答案：」，同學才能對照自評。");
    return { ...base, reference: q.reference || "", rubric: q.rubric || "" };
  });

  if (!out.length && !errors.length) errors.push({ message: "沒有找到任何題目。題目請用「1.」「2.」這樣的題號開頭。" });
  if (out.length > MAX_QUESTIONS) errors.push({ message: `題目太多（${out.length} 題），一份考卷最多 ${MAX_QUESTIONS} 題。` });
  const usedGroups = groups.filter(g => out.some(x => x.group === g.id));
  return { questions: out, groups: usedGroups, errors };
}

// 題型統計、總分
export function summarize(parsed) {
  const count = {};
  for (const q of parsed.questions) count[q.type] = (count[q.type] || 0) + 1;
  const total = parsed.questions.reduce((s, q) => s + q.points, 0);
  return { count, total, questionCount: parsed.questions.length };
}

// 給同學作答用：拿掉答案、解析、參考答案
export function publicExam(parsed) {
  return {
    groups: parsed.groups,
    questions: parsed.questions.map(({ answer, explanation, reference, rubric, ...rest }) => rest)
  };
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// 批改：回傳每題結果與總分（申論題先給 0 分，等同學自評）
export function grade(parsed, answers) {
  const results = {};
  const given = {};
  let score = 0, maxScore = 0;
  for (const q of parsed.questions) {
    const a = answers?.[q.id];
    maxScore += q.points;
    let correct = false, earned = 0, g = null;
    if (q.type === "single") {
      g = typeof a === "string" ? letter(a).slice(0, 1) : null;
      correct = g != null && g === q.answer;
    } else if (q.type === "multi") {
      g = Array.isArray(a) ? [...new Set(a.map(x => letter(x).slice(0, 1)))].filter(Boolean).sort() : [];
      correct = sameSet(g, q.answer || []);
    } else if (q.type === "tf") {
      g = typeof a === "boolean" ? a : null;
      correct = g !== null && g === q.answer;
    } else if (q.type === "fill") {
      g = Array.isArray(a) ? a.slice(0, q.blanks).map(x => String(x ?? "").slice(0, 200)) : [];
      const marks = q.answer.map((alts, i) => alts.some(alt => norm(alt) === norm(g[i])));
      const right = marks.filter(Boolean).length;
      earned = q.answer.length ? Math.round(q.points * right / q.answer.length * 100) / 100 : 0;
      correct = right === q.answer.length;
      results[q.id] = { correct, earned, blanks: marks };
      given[q.id] = g;
      score += earned;
      continue;
    } else if (q.type === "essay") {
      g = typeof a === "string" ? a.slice(0, MAX_ESSAY_TEXT) : "";
      results[q.id] = { correct: null, earned: 0, selfScored: false };
      given[q.id] = g;
      continue;
    }
    earned = correct ? q.points : 0;
    results[q.id] = { correct, earned };
    given[q.id] = g;
    score += earned;
  }
  return { results, given, score: Math.round(score * 100) / 100, maxScore };
}

// 申論題自評：只接受申論題、分數限制在 0～配分，以 0.5 分為單位
export function applySelfScores(parsed, results, selfScores) {
  for (const q of parsed.questions) {
    if (q.type !== "essay" || !(q.id in (selfScores || {}))) continue;
    let n = Number(selfScores[q.id]);
    if (!Number.isFinite(n)) continue;
    n = Math.min(q.points, Math.max(0, Math.round(n * 2) / 2));
    results[q.id] = { correct: null, earned: n, selfScored: true };
  }
  const score = Object.values(results).reduce((s, r) => s + (r.earned || 0), 0);
  return Math.round(score * 100) / 100;
}
