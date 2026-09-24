// Shared by AuthorHal.js (single author) and MemberListDialog.js (team/
// structure member lists) so an ORCID is never rendered two different ways.
// `orcid` is whatever hal.js's fetchAuthorInfo/fetchAuthorInfos hand back
// (HAL's own orcidId_s, bare -- no https://orcid.org/ prefix -- unlike
// dblp's own /author-info endpoint, which does add it; the .replace below is
// a no-op for HAL's own bare form and only matters if that ever changes).
export function OrcidLine({ orcid }) {
  if (!orcid) return null;
  return <> · ORCID: <a href={orcid} target="_blank" rel="noreferrer">{orcid.replace('https://orcid.org/', '')}</a></>;
}
