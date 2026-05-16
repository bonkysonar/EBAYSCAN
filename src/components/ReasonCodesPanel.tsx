type Props = {
  reasons: string[];
  warnings: string[];
};

export function ReasonCodesPanel({ reasons, warnings }: Props) {
  return (
    <section className="panel reasons-panel">
      <h2>Why</h2>
      <ul>
        {reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      {warnings.length ? (
        <>
          <h3>Warnings</h3>
          <ul>
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </>
      ) : null}
    </section>
  );
}
