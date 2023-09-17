export const ensureArray = (obj) => {
        return Array.isArray(obj) ? obj : obj ? [obj] : [];
};
