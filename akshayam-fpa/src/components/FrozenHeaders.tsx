"use client";

import { useEffect } from "react";

/**
 * Keeps every table's column headings on screen while its rows scroll past.
 *
 * A table sits in a `.table-frame` so that a wide one can scroll sideways, and
 * a box that scrolls sideways cannot also hold a heading to the page's top edge
 * with CSS alone (`position: sticky` binds to the nearest scrolling box, and
 * that box never scrolls vertically). So the page does it: on scroll, each
 * frame's headings are moved down by however far the frame's top has gone above
 * the nav bar, and no further than the last row - the headings leave with the
 * card, rather than hanging over whatever follows it.
 *
 * Only the outermost table of a frame is moved; a drill-down nested in a row
 * keeps its own heading in place.
 */
export function FrozenHeaders() {
  useEffect(() => {
    let frame = 0;

    const apply = () => {
      frame = 0;
      // Whatever the page pins to its own top - the nav bar - is where the
      // headings should come to rest.
      const bar = document.querySelector("header");
      const stuckAt = bar ? bar.getBoundingClientRect().bottom : 0;

      for (const box of document.querySelectorAll<HTMLElement>(".table-frame")) {
        const table = box.querySelector("table");
        const head = table?.tHead;
        if (!table || !head) continue;
        const cells = head.querySelectorAll<HTMLElement>(":scope > tr > th, :scope > tr > td");
        const tableRect = table.getBoundingClientRect();
        const room = tableRect.height - head.getBoundingClientRect().height;
        const shift = Math.min(Math.max(stuckAt - tableRect.top, 0), Math.max(room, 0));
        const value = shift > 0 ? `translateY(${Math.round(shift)}px)` : "";
        cells.forEach((c) => {
          if (c.style.transform !== value) c.style.transform = value;
        });
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Tables arrive and grow as a page navigates and as rows are opened.
    const watcher = new MutationObserver(schedule);
    watcher.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      watcher.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
