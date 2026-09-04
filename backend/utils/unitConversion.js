// Alias satuan yang umum dipakai di Indonesia -> bentuk baku
const UNIT_ALIASES = {
    g: 'g', gr: 'g', gram: 'g',
    kg: 'kg', kilogram: 'kg',
    mg: 'mg', miligram: 'mg',
    ml: 'ml', mililiter: 'ml',
    l: 'l', liter: 'l', litre: 'l',
};

// Faktor konversi ke satuan terkecil dalam grupnya (gram untuk massa, ml untuk volume)
const UNIT_GROUPS = {
    mass: { g: 1, kg: 1000, mg: 0.001 },
    volume: { ml: 1, l: 1000 },
};

function normalizeUnit(unit) {
    if (!unit) return null;
    const key = unit.trim().toLowerCase();
    return UNIT_ALIASES[key] || key;
}

function findGroup(normalizedUnit) {
    for (const [groupName, factors] of Object.entries(UNIT_GROUPS)) {
        if (normalizedUnit in factors) return groupName;
    }
    return null;
}

// Konversi quantity dari fromUnit ke toUnit. Return null kalau kedua satuan tidak sekeluarga (tidak bisa dikonversi).
function convertQuantity(quantity, fromUnit, toUnit) {
    const from = normalizeUnit(fromUnit);
    const to = normalizeUnit(toUnit);
    if (!from || !to) return null;
    if (from === to) return quantity;

    const fromGroup = findGroup(from);
    const toGroup = findGroup(to);
    if (!fromGroup || !toGroup || fromGroup !== toGroup) return null;

    const factors = UNIT_GROUPS[fromGroup];
    const baseQuantity = quantity * factors[from];
    return baseQuantity / factors[to];
}

function isConvertible(fromUnit, toUnit) {
    return convertQuantity(1, fromUnit, toUnit) !== null;
}

module.exports = { convertQuantity, isConvertible, normalizeUnit };
