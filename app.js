// Builds one tile per entry in tools.json. All tool details live in that file;
// nothing here needs to change when a tool is added, renamed or moved.
//
// A tile is a card whose tool name is the main link, stretched over the whole
// card (CSS ::after), so a click anywhere opens the tool. An optional `related`
// block adds a few staff links (e.g. Patient Hub's editors) that sit above the
// stretched link: links cannot nest, so this is how one card holds several.

const COLORS = ["blue", "indigo", "teal", "green", "orange", "pink", "red", "gray"];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function relatedBlock(related) {
  const box = el("div", "related");
  const head = el("p", "related-head", related.label || "Related");
  if (related.access) head.append(el("span", "related-access", related.access));
  const list = el("ul", "related-links");
  list.setAttribute("aria-label", related.label || "Related");
  for (const link of related.links || []) {
    const li = el("li");
    const a = el("a", null, link.name);
    a.href = link.url;
    li.append(a);
    list.append(li);
  }
  box.append(head, list);
  return box;
}

function tile(tool) {
  const li = el("li");
  const card = el("article", "tile");

  const icon = el("span", "icon " + (COLORS.includes(tool.color) ? tool.color : "gray"));
  const img = document.createElement("img");
  img.src = tool.icon;
  img.alt = "";
  icon.append(img);

  const name = el("h2", "name");
  const main = el("a", "main", tool.name);
  main.href = tool.url;
  name.append(main);

  card.append(icon, name, el("p", "desc", tool.description));
  if (tool.access) card.append(el("span", "access", tool.access));
  if (tool.related && (tool.related.links || []).length) card.append(relatedBlock(tool.related));
  li.append(card);
  return li;
}

async function main() {
  const list = document.getElementById("tools");
  try {
    const res = await fetch("tools.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("tools.json returned " + res.status);
    const tools = await res.json();
    list.replaceChildren(...tools.map(tile));
  } catch (err) {
    console.error(err);
    list.innerHTML = '<li class="error">The tool list could not be loaded. Please refresh the page.</li>';
  }
}

main();
