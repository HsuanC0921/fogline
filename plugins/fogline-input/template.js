const code = (activeLang?.code || activeLangPrefix || "").toLowerCase();
const native = !!(imeState && imeState.native);
let glyph;
if (code.startsWith("zh")) glyph = native ? "中" : "英";
else if (code.startsWith("ja")) glyph = !native ? "A" : imeState.katakana ? "ア" : "あ";
else if (code.startsWith("ko")) glyph = native ? "한" : "A";
else glyph = (activeLangPrefix || "?").toUpperCase();
return glyph;
