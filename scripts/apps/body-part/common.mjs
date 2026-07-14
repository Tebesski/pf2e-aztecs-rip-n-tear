import { getActorIwrList } from "../../actor-support.mjs"

export function formatIwrStr(str) {
   if (!str) return ""
   return str
      .split(",")
      .map((s) => {
         return s
            .trim()
            .split(" ")
            .map((part) => {
               if (!part) return ""
               return part
                  .split("-")
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(" ")
            })
            .join(" ")
      })
      .join(", ")
}

export function getActorIwrFallback(actor) {
   const mapSys = (list) => {
      if (!list) return { main: "", exc: "" }
      const ms = [],
         es = []
      for (const x of list) {
         ms.push(x.type + (x.value ? ` ${x.value}` : ""))
         if (x.exceptions) es.push(...x.exceptions)
      }
      return { main: ms.join(", "), exc: es.join(", ") }
   }

   const imm = mapSys(getActorIwrList(actor, "immunities"))
   const wk = mapSys(getActorIwrList(actor, "weaknesses"))
   const res = mapSys(getActorIwrList(actor, "resistances"))

   return {
      immune: imm.main,
      immuneExc: imm.exc,
      weak: wk.main,
      weakExc: wk.exc,
      resist: res.main,
      resistExc: res.exc,
   }
}

