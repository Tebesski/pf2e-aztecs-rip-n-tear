function elementHtml(tagName, text, attributes = {}) {
   const element = document.createElement(tagName)
   for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined && value !== null) element.setAttribute(key, value)
   }
   element.textContent = String(text ?? "")
   return element.outerHTML
}

export function strongText(text) {
   return elementHtml("strong", text)
}

export function emText(text) {
   return elementHtml("em", text)
}

export function coloredSpan(text, color) {
   return elementHtml("span", text, { style: `color:${color};` })
}

export function unorderedListHtml(items) {
   const list = document.createElement("ul")
   for (const item of items) {
      const entry = document.createElement("li")
      entry.textContent = String(item ?? "")
      list.appendChild(entry)
   }
   return list.outerHTML
}
