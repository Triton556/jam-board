import type { Report } from "../../bindings";
import { Markdown } from "../../components/Markdown";
import { Stamp } from "../../components/ui";

/** The complete captured report, shared by the reading view and decision dialog. */
export function ReportEvidence({
  report,
  expandFiles = false,
}: {
  report: Report;
  expandFiles?: boolean;
}) {
  return (
    <>
      <Markdown>{report.summaryMd}</Markdown>
      <details className="ink-disclosure" open={expandFiles}>
        <summary>Changed files · {report.changedFiles.length}</summary>
        {report.changedFiles.length ? (
          <ul>
            {report.changedFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No changed files reported.</p>
        )}
      </details>
      {report.tests.length ? (
        <div className="report-tests">
          <table aria-label="Reported tests">
            <thead>
              <tr>
                <th>Test and command</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {report.tests.map((test) => (
                <tr key={test.name}>
                  <td>
                    <strong>{test.name}</strong>
                    {test.command && (
                      <code className="report-command">{test.command}</code>
                    )}
                  </td>
                  <td>{test.expected}</td>
                  <td>{test.actual}</td>
                  <td>
                    <Stamp className={`test-${test.result.toLowerCase()}`}>
                      {test.result}
                    </Stamp>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small muted">No test results reported.</p>
      )}
      {report.deviationsMd && (
        <>
          <h4>Deviations</h4>
          <Markdown>{report.deviationsMd}</Markdown>
        </>
      )}
      {report.notVerifiedMd && (
        <>
          <h4>Not verified</h4>
          <Markdown>{report.notVerifiedMd}</Markdown>
        </>
      )}
    </>
  );
}
