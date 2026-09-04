function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isValidPrice(value) {
    if (value === '' || value === null || value === undefined) return false;
    const num = Number(value);
    return !isNaN(num) && num >= 0;
}

function isPositiveNumber(value) {
    if (value === '' || value === null || value === undefined) return false;
    const num = Number(value);
    return !isNaN(num) && num > 0;
}

function isPositiveInteger(value) {
    const num = Number(value);
    return Number.isInteger(num) && num > 0;
}

module.exports = { isNonEmptyString, isValidPrice, isPositiveNumber, isPositiveInteger };
