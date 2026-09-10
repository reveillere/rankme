import ListItemText from '@mui/material/ListItemText';

// One person's name + affiliation + id, shared by every "pick an author"
// list in the app -- Search.js's live results and Recent history, and
// Teams.js's member search -- so the same person looks the same way
// regardless of which of those found them.
export function PersonListItemText({ name, affiliation, idLabel, idValue }) {
  return (
    <ListItemText
      primary={<span style={{ fontWeight: 'bold' }}>{name}</span>}
      secondary={
        <>
          {(affiliation || []).map((affil, index) => (
            <span key={index} style={{ fontStyle: 'italic', display: 'block' }}>
              {affil}
            </span>
          ))}
          {idValue && (
            <span style={{ fontFamily: 'monospace', fontSize: '0.85em', color: 'gray', display: 'block' }}>
              {idLabel}: {idValue}
            </span>
          )}
        </>
      }
    />
  );
}
