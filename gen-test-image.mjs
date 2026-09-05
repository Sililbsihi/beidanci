// 生成仿真词表图片：4 栏 x 42 行 = 168 条目（含数字+单词短语）
import sharp from "/workspace/projects/node_modules/sharp/lib/index.js";

const col1 = ["needs","serious problem","demand","population","expanding industry","fossil fuels","gas","coal","oil","environment","years","scientists","renewable sources","sun","wind","pollution","marine renewable","energy","tidal energy","effective","difference","high","low tides","5 metres","40 places","right conditions","tidal lagoon","sea water","sea","current plan","coastal lagoon","coast","area","water","bay","U-shaped breakwater","dam","coast","breakwater","16 hydro turbines","tide","ocean energy"];
const col2 = ["movement","source","oceans","marine renewable","energy","three main categories","wave energy","tidal energy","ocean thermal energy","conversion","words","wave energy","numerous devices","wave energy","names","efficient method","form","energy","water","breakwater","turbines","generator","electricity","3 hours","tide","water","breakwater","difference","water level","several metres","higher","lagoon","open sea","stored water","gates","breakwater","lagoon","turbines","breakwater","opposite direction","megawatts","electricity"];
const col3 = ["potential","constant","danger","waves","electricity","onshore systems","reservoir","offshore systems","problem","ocean waves","erratic","wind","direction","difficulty","efficient technology","waves","two high tides","lagoon scheme","electricity","4 times","14 hours","24","enough electricity","150,000 homes","system","favour","solar","wind energy","weather","turbines","fuel","greenhouse gas","emissions","little maintenance","electricity","cheap","components","2,000 jobs","big boost","local economy","fears","lagoons"];
const col4 = ["same straight line","drawback","sand","sediment","ocean floor","environmental problems","second category","marine energy","tidal energy","major advantage","tide","waves","source","energy","predictable","exact times","high","low tides","fish and birds","migration patterns","build-up","silt","local ecosystems","forms","tidal energy","third category","marine energy","ocean thermal energy","conversion","big difference","temperature","surface water","kilometres","surface","tropical coastal areas","cold water","surface","submerged pipe","concept","1881","warm water","ammonia"];

const all = [...col1, ...col2, ...col3, ...col4];
console.log("total entries:", all.length);

const W = 600, H = 778;
let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff"/>`;
const colW = W / 4;
for (let c = 0; c < 4; c++) {
  const items = all.slice(c * 42, (c + 1) * 42);
  items.forEach((word, r) => {
    svg += `<text x="${c * colW + 12}" y="${30 + r * 18}" font-family="DejaVu Sans" font-size="12" fill="#111111">${word.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
  });
}
svg += "</svg>";

await sharp(Buffer.from(svg)).png().toFile("/tmp/wordlist-test.png");
console.log("image written: /tmp/wordlist-test.png");
