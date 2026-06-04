import { test, expect } from "@playwright/test";
import { join } from "path";

const holderSel = ".tabulator-tableholder";

// Regression coverage for issue #3654 "Tabulator vertical scroll skipping / jumping".
//
// Root cause: _virtualRenderFill summed each row's getHeight() straight into
// the top/bottom padding totals. A row that was first measured while detached
// caches an undefined outerHeight but is still flagged heightInitialized, so it
// was skipped by the height re-init and its getHeight() returned undefined.
// "rowsHeight += undefined" produced NaN padding, the CSS padding collapsed to
// 0, the table's scroll height collapsed with it and the view lurched on every
// scroll-up step. The fix re-initialises rows whose cached height is invalid
// and falls back to the estimated vDomRowHeight, matching the guard the
// _addTopRow/_addBottomRow/_remove* helpers already use.
//
// Reproduction (from the issue):
//   1. scroll to the bottom of a table with variable height rows,
//   2. engage the horizontal scrollbar,
//   3. scroll back up -> the rows jump partway back down on each step.
//
// HOW THE JUMP IS MEASURED
// When you scroll up by D pixels the visible content must move DOWN by exactly
// D. We track one identifiable row element across a scroll-up step and compare
// how far it moved on screen ("moved") with how far the holder actually
// scrolled ("scrolled"). For a correct virtual DOM the row is glued to the
// content so moved === scrolled; "jump = moved - scrolled" is therefore the
// number of pixels the content shifted underneath the scroll position. This
// metric is independent of whether scrollTop itself is trustworthy (it isn't,
// once the bug fires).
//
// The companion "gentle scrolling" test below demonstrates that this metric
// reads ~0 for well-behaved scrolling, so a large reading is a real jump.

const DELTA = 250;

async function scrollToBottom(page, step) {
	for (let i = 0; i < 400; i++) {
		const done = await page.evaluate((sel) => {
			const h = document.querySelector(sel);
			return h.scrollTop >= h.scrollHeight - h.clientHeight - 1;
		}, holderSel);
		if (done) break;
		await page.mouse.wheel(0, step);
		await page.waitForTimeout(8);
	}
	await page.waitForTimeout(100);
}

// Scroll up `steps` times by `delta` px, returning the per-step jump samples.
async function scrollUpAndMeasure(page, delta, steps) {
	const jumps = [];
	for (let i = 0; i < steps; i++) {
		const before = await page.evaluate((sel) => {
			const holder = document.querySelector(sel);
			const mid =
				holder.getBoundingClientRect().top + holder.clientHeight / 2;
			const rows = [...holder.querySelectorAll(".tabulator-row")];
			let best = null,
				bestDist = Infinity;
			for (const r of rows) {
				const d = Math.abs(r.getBoundingClientRect().top - mid);
				if (d < bestDist) {
					bestDist = d;
					best = r;
				}
			}
			if (!best) return null;
			const cell = best.querySelector(".tabulator-cell");
			return {
				id: cell ? cell.textContent : null,
				top: best.getBoundingClientRect().top,
				scrollTop: holder.scrollTop,
			};
		}, holderSel);

		await page.mouse.wheel(0, -delta);
		await page.waitForTimeout(20);

		const after = await page.evaluate(
			({ sel, id }) => {
				const holder = document.querySelector(sel);
				const rows = [...holder.querySelectorAll(".tabulator-row")];
				for (const r of rows) {
					const cell = r.querySelector(".tabulator-cell");
					if (cell && cell.textContent === id) {
						return {
							found: true,
							top: r.getBoundingClientRect().top,
							scrollTop: holder.scrollTop,
						};
					}
				}
				return { found: false, scrollTop: holder.scrollTop };
			},
			{ sel: holderSel, id: before ? before.id : null },
		);

		if (!before) break;
		if (after.found) {
			const moved = after.top - before.top; // screen movement (down +)
			const scrolled = before.scrollTop - after.scrollTop; // scroll dist
			// Once nothing moves any more we have reached the top of the table.
			if (Math.abs(moved) < 3 && Math.abs(scrolled) < 3) break;
			jumps.push({
				id: before.id,
				moved: Math.round(moved),
				scrolled: Math.round(scrolled),
				jump: Math.round(moved - scrolled),
			});
		}
	}
	return jumps;
}

test.describe("Vertical scroll jumping with variable height rows (#3654)", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`file://${join(__dirname, "scroll-jump.html")}`);
		await page.waitForSelector(".tabulator-row");
		await page.locator(holderSel).hover();
	});

	test("scrolling up after a fast scroll does not make content jump", async ({
		page,
	}) => {
		// 1. Fast-scroll to the bottom (large wheel deltas skip rows).
		await scrollToBottom(page, 900);

		// 2. Engage the horizontal scrollbar (part of the reproduction).
		await page.evaluate((sel) => {
			document.querySelector(sel).scrollLeft = 300;
		}, holderSel);
		await page.waitForTimeout(50);

		// 3. Scroll back up and measure the content jump.
		const jumps = await scrollUpAndMeasure(page, DELTA, 40);
		const worstJump = jumps.reduce(
			(max, j) => Math.max(max, Math.abs(j.jump)),
			0,
		);

		console.log("scroll-up steps:", JSON.stringify(jumps));
		console.log("worst jump (px):", worstJump);

		// Sanity: the scroll-up actually moved content.
		expect(jumps.length).toBeGreaterThan(0);

		// The tracked row should stay glued to the content (move by exactly the
		// scroll distance, give or take sub-pixel rounding). A larger reading
		// is the #3654 jump.
		expect(worstJump).toBeLessThanOrEqual(20);
	});

	// CONTROL: gentle, incremental scrolling does not skip rows and so must not
	// jump. This proves the jump metric reads ~0 for correct scrolling, so the
	// failure above is a genuine bug and not an artefact of the measurement.
	test("gentle incremental scrolling does not jump", async ({ page }) => {
		// Gently scroll down to roughly the middle, small steps.
		for (let i = 0; i < 60; i++) {
			await page.mouse.wheel(0, 120);
			await page.waitForTimeout(20);
		}
		await page.evaluate((sel) => {
			document.querySelector(sel).scrollLeft = 300;
		}, holderSel);
		await page.waitForTimeout(50);

		const jumps = await scrollUpAndMeasure(page, 120, 30);
		const worstJump = jumps.reduce(
			(max, j) => Math.max(max, Math.abs(j.jump)),
			0,
		);

		console.log("gentle scroll-up steps:", JSON.stringify(jumps));
		console.log("gentle worst jump (px):", worstJump);

		expect(jumps.length).toBeGreaterThan(5);
		expect(worstJump).toBeLessThanOrEqual(5);
	});
});
