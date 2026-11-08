/*
 * Grocery List — shared helpers
 * ------------------------------------------------------------
 * This exact file is used in TWO places:
 *   1. The phone app (website)       -> shared.js
 *   2. The Apps Script backend       -> paste into a script file named "Shared"
 * Plain functions only (no import/export) so it runs in both.
 */

var GL_CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Deli', 'Frozen',
  'Pantry', 'Snacks', 'Beverages', 'Household', 'Personal Care', 'Baby', 'Pet', 'Other'
];

// Keywords per category. The LONGEST matching keyword wins,
// so "peanut butter" -> Pantry beats "butter" -> Dairy.
var GL_CATEGORY_WORDS = {
  'Produce': 'apple|banana|orange|lemon|lime|grape|strawberry|strawberries|blueberry|blueberries|raspberry|raspberries|berries|peach|peaches|pear|plum|cherry|cherries|melon|watermelon|cantaloupe|pineapple|mango|avocado|kiwi|tomato|potato|sweet potato|onion|garlic|ginger|carrot|celery|lettuce|romaine|spinach|kale|cabbage|broccoli|cauliflower|cucumber|zucchini|squash|pepper|bell pepper|jalapeno|mushroom|corn|green bean|asparagus|cilantro|parsley|basil|salad|salad mix|fruit|vegetable|veggies|herbs|scallion|green onion|radish|beet|clementine|cuties',
  'Meat & Seafood': 'chicken|chicken breast|chicken thigh|wings|beef|ground beef|hamburger|steak|pork|pork chop|bacon|sausage|ham|turkey|ground turkey|lamb|ribs|roast|brisket|hot dog|bratwurst|brats|fish|salmon|shrimp|tilapia|cod|crab|lobster|scallop|meatball|venison',
  'Dairy & Eggs': 'milk|egg|butter|cheese|cheddar|mozzarella|parmesan|cream cheese|sour cream|cream|heavy cream|half and half|yogurt|greek yogurt|cottage cheese|whipped cream|cool whip|creamer|coffee creamer|margarine|string cheese|almond milk|oat milk',
  'Bakery': 'bread|bagel|bun|hamburger bun|hot dog bun|roll|dinner roll|tortilla|pita|english muffin|muffin|croissant|cake|donut|doughnut|pie',
  'Deli': 'deli meat|lunch meat|sliced turkey|salami|pepperoni|prosciutto|hummus|rotisserie chicken|sliced cheese|potato salad|coleslaw',
  'Frozen': 'frozen|ice cream|frozen pizza|pizza|frozen vegetable|frozen fruit|waffle|popsicle|tater tot|french fries|fries|ice|frozen dinner|pot pie|ice pop',
  'Pantry': 'rice|pasta|spaghetti|noodle|macaroni|mac and cheese|flour|sugar|brown sugar|salt|black pepper|salt and pepper|spice|cinnamon|oil|olive oil|vegetable oil|cooking spray|vinegar|ketchup|mustard|mayo|mayonnaise|relish|bbq sauce|hot sauce|soy sauce|salsa|sauce|pasta sauce|tomato sauce|canned tomato|soup|broth|stock|beans|black beans|cereal|oatmeal|oats|peanut butter|jelly|jam|honey|syrup|maple syrup|baking soda|baking powder|yeast|vanilla|cake mix|brownie mix|coffee|tea|tuna|canned|salad dressing|ranch|dressing|breadcrumbs|stuffing|gravy|taco seasoning|taco shells|nutella|pancake mix',
  'Snacks': 'chips|potato chips|tortilla chips|pretzel|popcorn|crackers|cookie|cookies|candy|chocolate|granola bar|granola|nuts|peanuts|almonds|trail mix|fruit snacks|goldfish|gum|jerky',
  'Beverages': 'water|bottled water|sparkling water|soda|pop|coke|pepsi|sprite|juice|orange juice|apple juice|lemonade|beer|wine|seltzer|gatorade|energy drink|kombucha|coffee pods|k-cups',
  'Household': 'paper towel|toilet paper|napkin|tissues|kleenex|trash bag|garbage bag|dish soap|dishwasher pods|detergent|laundry detergent|dryer sheets|fabric softener|bleach|cleaner|sponge|aluminum foil|foil|plastic wrap|ziploc|sandwich bags|batteries|light bulb|paper plates|cups|lysol|wipes|air filter',
  'Personal Care': 'shampoo|conditioner|soap|body wash|toothpaste|toothbrush|floss|mouthwash|deodorant|razor|shaving cream|lotion|sunscreen|band-aids|bandaids|vitamins|medicine|tylenol|advil|ibuprofen|cotton balls|q-tips|tampons|pads',
  'Baby': 'diapers|baby wipes|formula|baby food',
  'Pet': 'dog food|cat food|cat litter|litter|dog treats|cat treats|pet food'
};

var _glCatRegexes = null;
function _glEscape(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function glNormalize(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9%&'\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Key used to detect duplicates: "Eggs" == "egg", "Tomatoes" == "tomato".
function glKey(name) {
  return glNormalize(name).split(' ').map(function (w) {
    if (w.length > 4 && /(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }).join(' ');
}

function glTitle(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function glCategorize(name, learned) {
  var n = glNormalize(name);
  if (learned && learned[glKey(name)]) return learned[glKey(name)];
  if (!_glCatRegexes) {
    _glCatRegexes = [];
    Object.keys(GL_CATEGORY_WORDS).forEach(function (cat) {
      GL_CATEGORY_WORDS[cat].split('|').forEach(function (w) {
        _glCatRegexes.push({ cat: cat, len: w.length,
          re: new RegExp('(^|[^a-z])' + _glEscape(w) + '(s|es)?($|[^a-z])') });
      });
    });
  }
  var best = null, bestLen = 0;
  for (var i = 0; i < _glCatRegexes.length; i++) {
    var r = _glCatRegexes[i];
    if (r.len > bestLen && r.re.test(n)) { best = r.cat; bestLen = r.len; }
  }
  return best || 'Other';
}

// ---------- Turning spoken/typed text into items ----------
var GL_KEEP_TOGETHER = ['mac and cheese', 'macaroni and cheese', 'salt and pepper', 'half and half',
  'peanut butter and jelly', 'chips and salsa', 'ham and cheese', 'pork and beans', 'rice and beans',
  'sweet and sour', 'oil and vinegar', 'ben and jerry', 'ben and jerrys', "ben and jerry's", 'm and m', 'm and ms'];

var GL_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, 'a dozen': 12, 'half a dozen': 6, 'half dozen': 6,
  'a couple': 2, 'a couple of': 2, couple: 2 };

var GL_UNITS = 'half gallons?|gallons?|lbs?|pounds?|oz|ounces?|bags?|box(?:es)?|cans?|bottles?|jars?|packs?|packages?|pkgs?|loaf|loaves|bunch(?:es)?|cartons?|heads?|quarts?|pints?|liters?|litres?|cases?|rolls?|sticks?|containers?|tubs?|bars?|dozen|blocks?|bricks?|slices?|pieces?|cups?';

// Find a known store name, ignoring case and a leading "the"
function glMatchStore(name, stores) {
  var n = glNormalize(name).replace(/^the /, '').replace(/'s$/, '');
  for (var i = 0; i < (stores || []).length; i++) {
    var s = glNormalize(stores[i]).replace(/^the /, '');
    if (s && (s === n || s + 's' === n || s === n + 's')) return stores[i];
  }
  return null;
}

function glParseOne(s, stores) {
  s = String(s || '').replace(/^(?:some|more|a few more|a few)\s+/i, '').trim();
  var store = null;
  if (stores && stores.length) {   // "peanuts from Menards", "paper towels at Costco"
    var sm = s.match(/^(.*\S)\s+(?:from|at|@|for)\s+(?:the\s+)?(.+)$/i);
    if (sm) { var st = glMatchStore(sm[2], stores); if (st) { store = st; s = sm[1]; } }
  }
  var re = new RegExp('^(\\d+(?:\\.\\d+)?|half a dozen|half dozen|a dozen|a couple(?: of)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)\\s+(?:(' + GL_UNITS + ')\\s+)?(?:of\\s+)?(.+)$', 'i');
  var m = s.match(re), qty = '', item = s;
  if (m) {
    var word = m[1].toLowerCase(), unit = (m[2] || '').toLowerCase(), rest = m[3];
    if (/^an?$/.test(word) && !unit) {
      item = rest; // "a banana" -> just "banana"
    } else {
      var n = /^\d/.test(word) ? word : String(GL_NUM[word] != null ? GL_NUM[word] : word);
      qty = unit ? n + ' ' + unit : n;
      item = rest;
    }
  }
  item = item.replace(/^of\s+/i, '').trim();
  return { item: glTitle(item).slice(0, 100), qty: qty, stores: store ? [store] : [] };
}

function glParseItems(text, stores) {
  var t = String(text || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:hey \w+[, ]+)?(?:please )?(?:can you )?(?:add|put|get|buy|we need|i need)\s+/i, '');
  t = t.replace(/\s+(?:to|on|onto)\s+(?:the |my |our )?(?:grocery |groceries |shopping )?list\s*[.!]?$/i, '');
  t = t.replace(/[.!?]+$/, '');
  GL_KEEP_TOGETHER.forEach(function (p) {
    t = t.replace(new RegExp('\\b' + _glEscape(p) + '\\b', 'gi'), function (m) {
      return m.replace(/ and /gi, ' \u0001 ');
    });
  });
  return t.split(/\s*(?:,|;|\n|\band\b|\balso\b|\bplus\b)\s*/i)
    .map(function (p) { return p.replace(/\u0001/g, 'and').trim(); })
    .filter(Boolean)
    .map(function (p) { return glParseOne(p, stores); })
    .filter(function (x) { return x.item; });
}

// "2 gallons" + "1 gallon" -> "3 gallons";  "2" + "" -> "2"
function glMergeQty(a, b) {
  a = String(a == null ? '' : a).trim(); b = String(b == null ? '' : b).trim();
  if (!a) return b;
  if (!b) return a;
  var ma = a.match(/^(\d+(?:\.\d+)?)\s*(.*)$/), mb = b.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (ma && mb && glKey(ma[2]) === glKey(mb[2])) {
    var sum = Math.round((parseFloat(ma[1]) + parseFloat(mb[1])) * 100) / 100;
    var unit = /s$/.test(ma[2]) ? ma[2] : (/s$/.test(mb[2]) ? mb[2] : (ma[2] || mb[2]));
    if (unit && sum > 1 && !/(s|oz|dozen)$/.test(unit)) unit += /(x|ch|sh)$/.test(unit) ? 'es' : 's';
    return unit ? sum + ' ' + unit : String(sum);
  }
  return a + ' + ' + b;
}

function glId() {
  return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Item store tags are stored as "Costco, Menards"
function glStoresOf(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}
