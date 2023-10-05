
export const ensureArray = (obj) => {
  return Array.isArray(obj) ? obj : obj ? [obj] : [];
};

export const trimLastDigits = (str) => {
  return str.replace(/\s*\d*$/, '').trim();
}
