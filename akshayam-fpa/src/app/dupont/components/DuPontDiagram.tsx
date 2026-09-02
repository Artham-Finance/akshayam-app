import { compactINR, percent } from "@/lib/format";
import type { DuPontResult } from "@/lib/reports/dupont";

/**
 * The DuPont tree, as a box-flow diagram.
 *
 *   NI÷Sales   Sales÷Assets   Assets÷Equity
 *      │            │              │
 *   Net Profit  Asset Turn.   Fin. Leverage
 *   Margin  ──×──   │              │
 *          Return on Assets  ──×── │
 *                    Return on Equity
 *
 * Server-rendered SVG, no client JS. Colours come from the app's navy tokens
 * so it tracks the theme; the whole thing scrolls sideways on a narrow screen
 * rather than shrinking to a speck.
 */

const W = 1160;
const H = 560;
const BOX_W = 158;
const BOX_H = 56;

function mult(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}×`;
}
function pct(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "—" : percent(v * 100, 1);
}

function Box({
  x,
  y,
  label,
  value,
  tone = "input",
}: {
  x: number;
  y: number;
  label: string;
  value: string;
  tone?: "input" | "ratio" | "result" | "roe";
}) {
  const fill =
    tone === "roe"
      ? "var(--color-navy-deep)"
      : tone === "result"
        ? "var(--color-navy)"
        : tone === "ratio"
          ? "var(--color-navy)"
          : "var(--color-navy-tint-strong)";
  const labelColor = tone === "input" ? "var(--color-navy-deep)" : "var(--color-ink-invert)";
  const valueColor = tone === "input" ? "var(--color-ink)" : "var(--color-ink-invert)";
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={BOX_W}
        height={BOX_H}
        rx={8}
        fill={fill}
        stroke="var(--color-navy-deep)"
        strokeOpacity={0.25}
      />
      <text
        x={x + BOX_W / 2}
        y={y + 22}
        textAnchor="middle"
        fontSize={12.5}
        fontWeight={600}
        fill={labelColor}
      >
        {label}
      </text>
      <text
        x={x + BOX_W / 2}
        y={y + 41}
        textAnchor="middle"
        fontSize={13}
        fontWeight={700}
        fill={valueColor}
      >
        {value}
      </text>
    </g>
  );
}

function Op({ x, y, symbol }: { x: number; y: number; symbol: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={20}
      fontWeight={700}
      fill="var(--color-ink-muted)"
    >
      {symbol}
    </text>
  );
}

/** Elbow connector from the bottom-centre of one box to the top-centre of another. */
function Elbow({ from, to }: { from: [number, number]; to: [number, number] }) {
  const midY = (from[1] + to[1]) / 2;
  return (
    <path
      d={`M ${from[0]} ${from[1]} V ${midY} H ${to[0]} V ${to[1]}`}
      fill="none"
      stroke="var(--color-line-strong)"
      strokeWidth={1.5}
    />
  );
}

export function DuPontDiagram({ data }: { data: DuPontResult }) {
  const { inputs, ratios } = data;

  // three input pairs across the top
  const pairCx = [200, 580, 960];
  const row1Y = 16;
  const row2Y = 156;
  const row3Y = 300;
  const row4Y = 440;

  // input boxes: left box, operator, right box, centred on pairCx
  const gap = 30;
  const leftX = (cx: number) => cx - BOX_W - gap / 2;
  const rightX = (cx: number) => cx + gap / 2;

  const ratioCx = pairCx; // ratio box sits under its pair
  const ratioX = (cx: number) => cx - BOX_W / 2;

  const roaCx = (ratioCx[0] + ratioCx[1]) / 2; // under NPM + Asset Turnover
  const roeCx = (roaCx + ratioCx[2]) / 2; // under RoA + Leverage

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto block h-auto w-full min-w-[820px] max-w-[1160px]"
        role="img"
        aria-label="DuPont decomposition of Return on Equity"
      >
        {/* ---- connectors (drawn first, behind the boxes) ---- */}
        {/* input pair -> ratio box */}
        {pairCx.map((cx, i) => (
          <g key={`c1-${i}`}>
            <Elbow from={[leftX(cx) + BOX_W / 2, row1Y + BOX_H]} to={[ratioCx[i], row2Y]} />
            <Elbow from={[rightX(cx) + BOX_W / 2, row1Y + BOX_H]} to={[ratioCx[i], row2Y]} />
          </g>
        ))}
        {/* NPM + Asset Turnover -> Return on Assets */}
        <Elbow from={[ratioCx[0], row2Y + BOX_H]} to={[roaCx, row3Y]} />
        <Elbow from={[ratioCx[1], row2Y + BOX_H]} to={[roaCx, row3Y]} />
        {/* Return on Assets + Financial Leverage -> Return on Equity */}
        <Elbow from={[roaCx, row3Y + BOX_H]} to={[roeCx, row4Y]} />
        <path
          d={`M ${ratioCx[2]} ${row2Y + BOX_H} V ${(row3Y + row4Y) / 2 + BOX_H / 2} H ${roeCx} V ${row4Y}`}
          fill="none"
          stroke="var(--color-line-strong)"
          strokeWidth={1.5}
        />

        {/* ---- row 1: inputs ---- */}
        <Box x={leftX(pairCx[0])} y={row1Y} label="Net Income" value={compactINR(inputs.netIncome)} />
        <Op x={pairCx[0]} y={row1Y + BOX_H / 2} symbol="÷" />
        <Box x={rightX(pairCx[0])} y={row1Y} label="Sales" value={compactINR(inputs.sales)} />

        <Box x={leftX(pairCx[1])} y={row1Y} label="Sales" value={compactINR(inputs.sales)} />
        <Op x={pairCx[1]} y={row1Y + BOX_H / 2} symbol="÷" />
        <Box x={rightX(pairCx[1])} y={row1Y} label="Total Assets" value={compactINR(inputs.totalAssets)} />

        <Box x={leftX(pairCx[2])} y={row1Y} label="Total Assets" value={compactINR(inputs.totalAssets)} />
        <Op x={pairCx[2]} y={row1Y + BOX_H / 2} symbol="÷" />
        <Box x={rightX(pairCx[2])} y={row1Y} label="Total Equity" value={compactINR(inputs.totalEquity)} />

        {/* ---- row 2: ratios ---- */}
        <Box x={ratioX(ratioCx[0])} y={row2Y} tone="ratio" label="Net Profit Margin" value={pct(ratios.netProfitMargin)} />
        <Op x={(ratioCx[0] + ratioCx[1]) / 2} y={row2Y + BOX_H / 2} symbol="×" />
        <Box x={ratioX(ratioCx[1])} y={row2Y} tone="ratio" label="Asset Turnover" value={mult(ratios.assetTurnover)} />
        <Box x={ratioX(ratioCx[2])} y={row2Y} tone="ratio" label="Financial Leverage" value={mult(ratios.financialLeverage)} />

        {/* ---- row 3: Return on Assets ---- */}
        <Box x={roaCx - BOX_W / 2} y={row3Y} tone="result" label="Return on Assets" value={pct(ratios.returnOnAssets)} />
        <Op x={(roaCx + ratioCx[2]) / 2} y={row3Y + BOX_H / 2} symbol="×" />

        {/* ---- row 4: Return on Equity ---- */}
        <Box x={roeCx - BOX_W / 2} y={row4Y} tone="roe" label="Return on Equity" value={pct(ratios.returnOnEquity)} />
      </svg>
    </div>
  );
}
