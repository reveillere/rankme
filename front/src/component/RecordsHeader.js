// Shared heading for author, team and structure record pages.  The page
// supplies its identity/membership detail and its source-specific export
// action; layout of the title, record count and right-aligned export stays
// identical everywhere.
export function RecordsHeader({ title, details, showing, exportButton }) {
  return (
    <div style={{ textAlign: 'center', marginTop: '40px', width: '100vw', maxWidth: '100vw' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px' }}><h1 style={{ margin: 0, lineHeight: 1.15 }}>{title}</h1><HelpButton title="Records help" sections={[{ title: 'Browse records', description: 'Use filters and sorting to choose which records are shown.' }, { title: 'Export formats', description: 'Export always contains the records currently shown. Markdown is readable as a report, JSON preserves structured data, and CSV opens in spreadsheet software.' }, { title: 'Cross-check', description: 'Cross-check compares the current source with its matching HAL or DBLP identity when available.' }]} /></div>
      {details && <div style={{ fontStyle: 'italic', fontSize: 'small', color: '#8a8f94', marginTop: '6px', lineHeight: 1 }}>{details}</div>}
      <div style={{ fontSize: 'large', marginTop: '5px', lineHeight: 1.2, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span>{showing}</span>
        <div>{exportButton}</div>
      </div>
    </div>
  );
}
import { HelpButton } from './HelpButton';
