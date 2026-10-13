// Builds one tile per entry in tools.json. All tool details live in that file;
// nothing here needs to change when a tool is added, renamed or moved.

const COLORS = ["blue", "indigo", "teal", "green", "orange", "pink", "red", "gray"];

function tile(tool) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.className = "tile";
  a.href = tool.url;

  const icon = document.createElement("span");
  icon.className = "icon " + (COLORS.includes(tool.color) ? tool.color : "gray");
  const img = document.createElement("img");
  img.src = tool.icon;
  img.alt = "";
  icon.append(img);

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = tool.name;

  const desc = document.createElement("span");
  desc.className = "desc";
  desc.textContent = tool.description;

  a.append(icon, name, desc);
  if (tool.access) {
    const access = document.createElement("span");
    access.className = "access";
    access.textContent = tool.access;
    a.append(access);
  }
  li.append(a);
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
