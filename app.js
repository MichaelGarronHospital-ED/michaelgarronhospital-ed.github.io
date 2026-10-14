// Builds the page from tools.json. All tool details live in that file; nothing
// here needs to change when a tool is added, renamed, regrouped or moved.
//
// Tools are shown in groups (tools.json "group"; groups appear in the order they
// are first used). Each tool is one card: its name is the main link, stretched
// over the whole card (CSS ::after), so a click anywhere opens the tool. An
// optional `related` block adds a few staff links in a strip at the bottom of the
// card; they sit above the stretched link, because links cannot nest.

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

function card(tool) {
  const li = el("li");
  const card = el("article", "card");

  const row = el("div", "card-row");
  const icon = el("span", "icon " + (COLORS.includes(tool.color) ? tool.color : "gray"));
  const img = document.createElement("img");
  img.src = tool.icon;
  img.alt = "";
  icon.append(img);

  const text = el("div", "card-text");
  const name = el("h3", "name");
  const main = el("a", "main", tool.name);
  main.href = tool.url;
  name.append(main);
  text.append(name, el("p", "desc", tool.description));
  const chev = el("span", "chev");
  chev.setAttribute("aria-hidden", "true");

  row.append(icon, text, chev);
  card.append(row);
  if (tool.related && (tool.related.links || []).length) card.append(relatedBlock(tool.related));
  li.append(card);
  return li;
}

function render(tools) {
  const root = document.getElementById("tools");
  const groups = [];
  for (const t of tools) {
    const g = t.group || "Tools";
    let entry = groups.find((x) => x.name === g);
    if (!entry) { entry = { name: g, tools: [] }; groups.push(entry); }
    entry.tools.push(t);
  }
  root.replaceChildren(...groups.map((g, i) => {
    const section = el("section", "group");
    const id = "group-" + i;
    const h = el("h2", "group-title", g.name);
    h.id = id;
    const list = el("ul", "cards");
    list.setAttribute("aria-labelledby", id);
    list.append(...g.tools.map(card));
    section.append(h, list);
    return section;
  }));
}

async function main() {
  const root = document.getElementById("tools");
  try {
    const res = await fetch("tools.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("tools.json returned " + res.status);
    render(await res.json());
  } catch (err) {
    console.error(err);
    root.innerHTML = '<p class="error">The tool list could not be loaded. Please refresh the page.</p>';
  }
}

main();
