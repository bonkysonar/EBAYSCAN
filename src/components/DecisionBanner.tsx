import type { ListingConditionFilter, SearchInput } from "../lib/ebay/types";
import type { TriageDecision } from "../lib/scoring/types";

type Props = {
  decision: TriageDecision;
  input: SearchInput | null;
};

export function DecisionBanner({ decision, input }: Props) {
  return (
    <section className={`decision-banner ${decision.decision.toLowerCase()}`}>
      <div>
        <span className="decision-label">{decision.decision}</span>
        <h2>{decision.suggestedAction}</h2>
      </div>
      <div className="decision-meta">
        <strong>{Math.round(decision.confidence * 100)}%</strong>
        <span>confidence</span>
        <small>{input ? inputLabel(input) : "No input"}</small>
      </div>
    </section>
  );
}

function inputLabel(input: SearchInput): string {
  const condition = ` · ${conditionLabel(input.conditionFilter)}`;
  if (input.type === "barcode") return `Barcode: ${input.barcode}${condition}`;
  if (input.type === "catalog") return `Catalog: ${input.catalogNumber}${condition}`;
  if (input.type === "manual") return `Manual: ${input.query}${condition}`;
  return `Image: ${input.fileName ?? "uploaded cover"}${condition}`;
}

function conditionLabel(conditionFilter: ListingConditionFilter = "used"): string {
  if (conditionFilter === "new") return "new";
  if (conditionFilter === "both") return "new + used";
  return "used";
}
