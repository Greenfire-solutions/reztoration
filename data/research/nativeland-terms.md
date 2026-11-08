# Native Land Digital: what reuse is allowed

Checked 2026-11-07. Native Land Digital (NLD) has no page at native-land.ca/terms-of-use (it returns 404). The rules live in three places: the API docs, the Data Sovereignty Treaty inside the API docs, and the FAQ on the main site. They do not fully agree with each other, so the strictest one is the one to plan around.

## In plain words

1. **A key is needed, and it is free.** Since late 2024 every API request must carry an API key. You get one by signing up at native-land.ca and ticking a box that agrees to the Data Sovereignty Treaty. It costs nothing.
2. **Non-commercial only.** The treaty and the FAQ both say no commercial use: no charging for access, no subscriptions or paid bundles, no monetized platforms, no paid apps, books or merchandise. Educational, research and non-commercial use is allowed.
3. **Do not change the boundaries.** You may not modify or alter a territory shape without direct consultation with, and approval from, the Indigenous community involved.
4. **Storing or redistributing the data needs NLD's explicit permission.** The treaty says users must not "Store or distribute API data without explicit permission from Native Land Digital." Shipping the territories GeoJSON inside a public site (as a static file the browser downloads) is storing and distributing it.
5. **Attribution is required.** Credit Native Land Digital, link to native-land.ca, and acknowledge Indigenous communities as the rightful stewards of their data. The FAQ gives an exact credit line (below).
6. **Add a disclaimer.** The map does not show official or legal boundaries, and NLD asks reusers to say the same.
7. **The older "CC0" wording conflicts with the newer treaty.** The "About and Disclaimers" API page still says the dataset "can be considered under a CC0 license (free to use in any way you like)", and the Mapbox data-exchange page says credit is appreciated "but it's not required". The Data Sovereignty Treaty and the FAQ are stricter and newer (the key requirement started in late 2024 and you must agree to the treaty to get a key). Treat the treaty as the rule in force.

## What this means for Reztoration

- The file already in `data/raw/nativeland-territories.json` should not be published with the site until NLD gives explicit written permission to store and distribute it. Write to them through https://native-land.ca/contact, describe the project and whether it is free and non-commercial, and ask.
- If the project ever charges money, sells anything through the map, or is part of a paid service, NLD data cannot be in it at all.
- Polygons must be shown as NLD drew them. No simplifying, merging or re-cutting without the nation's approval. (Note: geometry simplification for performance may count as altering. Ask NLD about this in the same letter.)
- Every page or layer that shows NLD shapes needs the credit line and the "not legal boundaries" disclaimer.
- Linking out to each territory's NLD page (the `description` URL in each feature) is always fine and is a good alternative to redistributing shapes.

## Quotes and sources

Data Sovereignty Treaty, https://api-docs.native-land.ca/data-sovereignty-treaty

> "The NLD API may be used only for the following purposes: Educational and research purposes that align with the principles of Indigenous Data Sovereignty. Non-commercial applications that respect Indigenous governance and do not generate revenue."

> "Users must not: Charge money for access to or integration of NLD API data in any form, including as part of a subscription, membership, or bundled service. Modify or alter Indigenous land boundaries without direct consultation and approval from the Indigenous communities involved. Use the API for commercial purposes, including monetized platforms, data resale, or proprietary applications. Use the API in a way that undermines Indigenous governance or misrepresents Indigenous territories. Use the API to create derivative works that do not acknowledge Indigenous ownership and governance of data. Store or distribute API data without explicit permission from Native Land Digital."

> "All uses of the NLD API must attribute Native Land Digital as the original source of the data. Any publication, application, or research incorporating API data must acknowledge Indigenous communities as the rightful stewards of their data."

> "NLD reserves the right to immediately revoke API access if a user violates these terms."

Get and use your API key, https://api-docs.native-land.ca/get-and-use-your-api-key

> "As of late 2024, Native Land Digital started requiring all requests to use an API key. This is to help us steward this data more responsibly and learn more about who is using the data we provide. The data is still free, you just need to sign up to get a key."

Full GeoJSONs, https://api-docs.native-land.ca/full-geojsons

> "https://native-land.ca/api/polygons/geojson/[category]?key=your_api_key" (categories: territories, languages, treaties). "Please avoid calling this endpoint continually."

API home, https://api-docs.native-land.ca/

> "the Native Land map does not represent or intend to represent official or legal boundaries of any Indigenous nations. You are free to use the dataset for your own maps and applications using the Native Land Digital API, but we encourage you to add a similar disclaimer on your own resource."

About and Disclaimers, https://api-docs.native-land.ca/about-and-disclaimers (older wording, superseded in practice by the treaty)

> "You can give credit to "Native Land Digital", and link to our website. The dataset is publicly available and is not under any proprietary license; the work can be considered under a CC0 license (free to use in any way you like). We would, however, kindly ask that you consider the morality of how you use this dataset, be aware that it is constantly changing, and that it is not meant or reasonably to use for academic or legal purposes."

FAQ, https://native-land.ca/about/faq

> "You may print or use our maps for educational, research, or non-commercial purposes as long as you: Provide proper attribution to Native Land Digital. Include a link back to our website. Do not use our maps for monetary gain or commercial purposes."

> "Map data provided by Native Land Digital (https://native-land.ca/). Used with permission for educational and non-commercial purposes."

> "No. Native Land Digital maps cannot be used in commercial products, including for-profit books, applications, merchandise, or paid services. If you wish to discuss potential collaborations, please contact us."

> "Our maps and data are meant for educational and reference purposes only and should not be used for legal claims, land disputes, or governmental decision-making."

Mapbox data exchange listing, https://github.com/mapbox/data-exchange/blob/main/native-land.md (older wording)

> "We appreciate if you credit Native Land Digital and Native-Land.ca, but it's not required."

## Credit line to use

(This is NLD's own wording from the FAQ. The words "Used with permission" are only true once NLD has said yes, so get that answer first.)

Map data provided by Native Land Digital (https://native-land.ca/). Used with permission for educational and non-commercial purposes. Territories shown are not official or legal boundaries. Indigenous communities are the rightful stewards of this data.
