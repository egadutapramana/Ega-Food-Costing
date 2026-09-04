const { convertQuantity } = require('./unitConversion');

const DEFAULT_TARGET_FOOD_COST_PERCENT = 30;

// Hitung HPP, HPP per porsi, food cost %, dan status target dari satu resep + baris bahannya.
// ingredientRows: hasil join recipe_ingredients + ingredients (quantity_used, used_unit, name, unit, price_per_unit)
function calculateRecipeCost(recipe, ingredientRows) {
    const hpp = ingredientRows.reduce((total, item) => {
        const usedUnit = item.used_unit || item.unit;
        const convertedQty = convertQuantity(item.quantity_used, usedUnit, item.unit);
        const effectiveQty = convertedQty !== null ? convertedQty : item.quantity_used;
        return total + (effectiveQty * item.price_per_unit);
    }, 0);

    const hppPerPortion = hpp / (recipe.portion_yield || 1);
    const foodCostPercent = recipe.selling_price > 0
        ? (hppPerPortion / recipe.selling_price) * 100
        : null;

    const targetPercent = recipe.target_food_cost_percent != null
        ? recipe.target_food_cost_percent
        : DEFAULT_TARGET_FOOD_COST_PERCENT;
    const overTarget = foodCostPercent !== null && foodCostPercent > targetPercent;

    return {
        hpp_total: hpp,
        hpp_per_portion: hppPerPortion,
        food_cost_percentage: foodCostPercent,
        target_food_cost_percent: targetPercent,
        over_target: overTarget
    };
}

module.exports = { calculateRecipeCost, DEFAULT_TARGET_FOOD_COST_PERCENT };
