const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf-8");
const dom = new JSDOM(html);
const document = dom.window.document;
const img = document.getElementById("lightboxImg");
console.log(img.outerHTML);
