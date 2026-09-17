This is a bot to make the life for a small family much easier. The idea is to exterminate the time spent shopping groceries completely by planning ahead the weekly consume and using the modern delivery services. 

Workflow

There is a chat between the user and  the bot. The user tells the bot to prepare a grocery shopping list for the upcoming week. The bot will select out of a pool of prepared recipes in a diverse way: different cuisines, different sides, etc. The bot returns a list of suggested recipes. The user can ask for changes. If they are fine, the bot starts to map the necessary ingredients of all selected recipes onto real products in an online delivery grocery store. The products are added to a shopping cart in the correct quantities. To the cart a base set of items is added which is constant for every week.  The cart is then sent to the user who will review it, change it, and checks out with their payment method. There is also a dont-buy list of products we never want in our cart which the model respects when selecting products for the cart.

Functions

- /start <number-of-meals>: starts the workflow as described above
- /add-recipe: adds a recipe to the pool
- /edit-recipe <recipe-name>: edits recipe
- /remove-recipe <recipe-name>: removes recipe
- /edit-base: edits the base item list
- /help: lists all commands with helpful descriptions
- /add-dont-buy: adds a product from the delivery service we never want to have in the cart
- /remove-dont-buy: removes a product from the list of delivery-service products we never want in our cart
- /list-dont-buy: shows list of products we never want to buy

Recipe schema

All recipes are saved to feed two adults and one small child. No scaling has to be done. Recipes can contain a diverse set of units like: one onion, a clove of garlic, etc. The recipes should live in a database. It has a title, some tags like cuisine, hearty, rich, etc., and a list of ingredients. For some ingriedients, alternatives exist, for example fried rice with shrimp or chicken. Potential alternatives are included by the user. The modal can choose at run time between them, either for better variation across the meals or to catch a good deal on sale. 

Data model

Every ingredient is saved as `{ingredient_id, amount}` plus the verbatim `amount_text`. An amount is a small discriminated union instead of a fixed unit enum:

- `measured` – `{value, measure: gram|ml}` for 500 g, 1 l, 2 EL (~30 ml)
- `count`    – `{value, item}` for "1 Karotte", "3 Zehen" (item aliases normalized, e.g. Zehen/Knoblauchzehe → zehe)
- `container`– `{value}` for "1 Packung", "eine halbe Dose"
- `unquantified` – for "eine Prise", "etwas", "nach Geschmack"

The extraction LLM classifies the amount expression and copies it verbatim; it never converts it into fake units. When /add-recipe or /edit-recipe are called, the amount is validated and repaired (inconsistent fields fall back to `unquantified`).

Math model

The item decides how many packs to buy given the actual product size, so normalization happens late, at match time. A conventional function first resolves the pack count deterministically when the need and the pack size are comparable (measured vs. mass/volume, count vs. piece/multipack, container rounded up, unquantified → one pack). Only when the units are not comparable does the LLM estimate a pack count. Among products that the matcher deems acceptable, the cheapest total (packs × price) wins.

Order

1. The bot and user agree on a recipe list with open options (shrimp vs. chicken)
2. The bot aggregates all needed ingredients per amount kind (same ingredient + same kind/measure/item are summed)
3. The bot uses the configured delivery service's MCP to find products representing ingredients
    1. if product on dont-buy list → hard no
    2. choose the cheapest total (packs × price) among acceptable products; this also settles shrimp vs. chicken
4. The math model resolves pack counts deterministically, falling back to an LLM estimate only for incomparable units
5. shoppping cart can be assembled

Tech Stack

- TS/node
- grammY as bot framework
- DB: sqlite
- MCP: Knuspr (official) or Picnic (community), selected via GROCERY_PROVIDER
- LLM: API key provided in .env
- Deploy with docker compose

ADRs

1. This project should implement a small app used by two people at most.
2. The access of the two users is guaranteed with their telegram chat ids
3. All commands like edits or adds are executable in natural language.
4. The bot only assembles the shopping cart and does not do the checkout/order
5. The bot is a standalone app deployed on a VPS
6. A telegram bot is used as intergration is very easy and usability is guaranteed
7. we want to use an MCP server for product select and cart assembly: the official knuspr MCP or the community picnic MCP, selected via GROCERY_PROVIDER. 
8. A good result of the app highly depends on the math done right. The LLM classifies amounts and estimates pack counts only where units are not comparable; all comparable cases are computed deterministically.
9. If products don’t match the ingredients of recipes, the model makes a best guess for an alternative and notifies the user when sharing the shopping cart.
10. The product selection tool is asked to favor cheaper products; among acceptable products the cheapest total including the computed pack count wins.
11. The cart-assembly workflow is stateless, if it fails the users just run it again
12. There is state for all /edit and /add routines as they may need feedback from the user via the telegram channel
13. The cart review happens in the delivery service's UI by the user (knuspr or picnic). At that point the modal has done its task.
14. The model should check deals on sale in the shop.
15. All user interactions should be in German.
16. We don’t worry about concurrency as we assume that the to users will organize offline when to trigger the workflow.
17. All commands which are performed with natural language always ask for validation with the planned change via the telegram channel
18. If the only available product coincides with one from the dont-buy list, notify the use
19. Amounts use a small set of kinds (measured, count, container, unquantified) instead of a fixed unit list. Validation only repairs inconsistent extractions (falling back to unquantified); no semantic unit/ingredient checks are done.
20. Pack counts are normalised late, at match time, because whether "1 Karotte" means one piece or a 1 kg bag can only be decided with the actual product in hand.
21. Count items are alias-normalised (Zehen/Knoblauchzehe → zehe, Stück/Stk → stueck, ...) so synonymous counts aggregate across recipes.
22. Among products the matcher deems acceptable, the cheapest total (packs × price) is chosen; ties fall back to price/deal ordering.
