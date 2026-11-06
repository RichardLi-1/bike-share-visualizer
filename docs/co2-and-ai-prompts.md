# CO₂ saved and AI prompt estimates

How the `?co2` and `?prompts` videos get their numbers, for Thursday, August 13, 2026. These are rough estimates: the result depends mostly on one assumption, the share of rides that replace a car trip, and no Toronto figure for that has been found.

## Result

| Measure | Value |
|---|---|
| Rides | 45,305 |
| Distance ridden (estimated routes) | 117,756 km |
| E-bike distance | 34,117 km |
| **Estimated CO₂ saved** | **about 4,070 kg** |
| **Equivalent AI prompts** | **about 40.7 million** |

## CO₂ saved

```
saved = km × 17% × 205 g/km − e-bike km × 0.012 kWh/km × 73.8 g/kWh
      = 4,104 kg − 30 kg ≈ 4,070 kg
```

| Input | Value | Source |
|---|---|---|
| Rides that replace a car trip | 17% | [2018 Mobi member survey, Vancouver](https://cyclingincities.spph.ubc.ca/motivating-cycling/bikeshare-systems/). The same survey: 39% walking, 35% transit, 7% personal bike. |
| Car emissions | 205 g/km | 8.9 L/100 km ([IEA via Canada Energy Regulator](https://www.cer-rec.gc.ca/en/data-analysis/energy-markets/market-snapshots/2019/market-snapshot-how-does-canada-rank-in-terms-vehicle-fuel-economy.html), 2017) × 2.3 kg CO₂/L ([NRCan](https://natural-resources.canada.ca/sites/nrcan/files/oee/pdf/transportation/fuel-efficient-technologies/2023%20Fuel%20Consumption%20Guide.pdf)). Tailpipe only, one person per car. |
| E-bike energy | 12 Wh/km | Top of the measured 2–12 Wh/km range, to allow for charging losses (no direct figure found). |
| Grid intensity | 73.8 g/kWh | [The Atmospheric Fund](https://carbon.taf.ca/2024/electricity-grid), 2024, Greater Toronto and Hamilton Area. |

No saving is counted for rides that replace transit or walking. Taking one rider off a bus or subway doesn't remove the vehicle.

### What could change it

| Basis | Rate | Saved that day |
|---|---|---|
| Used here: 17% of rides replace a car | 35 g/km | about 4,070 kg |
| [NABSA 2020–2023](https://www.energy.gov/cmei/vehicles/articles/fotw-1370-november-25-2024-north-america-37-shared-micromobility-trips): 37% of shared bike and scooter trips | 76 g/km | about 8,900 kg |
| [City of Toronto 2025 figures](https://www.toronto.ca/wp-content/uploads/2026/03/96e8-2025-Toronto-Cycling-Year-in-Review-FINAL.pdf): 4,110 t over 27.3M km | 151 g/km | about 17,700 kg |

The City publishes no method. At 205 g/km its rate would need about 73% of rides to replace a car, which is about twice the highest survey figure found.

### Not included

- **Bike share's own footprint:** rebalancing vans, making bikes and building stations. One US life cycle study found rebalancing to be the largest source for station-based systems, and a summary of it gives about 65 g per bike-km overall. That couldn't be checked against the paper, but a figure that size would cancel the saving at 17%, so the true net saving could be much lower.
- **Round trips and trips that weren't mapped:** left out of the distance, so the count is a little low.
- **Longer real routes:** distances are shortest paths, so real rides were probably longer. The City's figures work out to 3.5 km a ride against 2.6 km here.

### Sources to avoid

The "over 40% of trips replaced a vehicle trip" figure in the [2016 Toronto bike share report](https://parking.greenp.com/documents/pamphlets/pa_00000009.pdf) comes from Denver B-cycle (footnote 14), not Toronto. That report recommends a Toronto survey on this question. No published result from one has been found.

## AI prompts

```
prompts = CO₂ saved ÷ 0.1 g per prompt
```

The 0.1 g comes from about 0.3 Wh a prompt × 345 g/kWh.

| Source | Per prompt | Prompts equal to 4,070 kg |
|---|---|---|
| [Google, Gemini median text prompt](https://arxiv.org/abs/2508.15734), May 2025, as published | 0.24 Wh, 0.03 g | about 136 million |
| **Used here** | **about 0.3 Wh, 0.1 g** | **about 40.7 million** |
| [Mistral Large 2](https://mistral.ai/news/our-contribution-to-a-global-environmental-standard-for-ai), 400-token response | 1.14 g | about 3.6 million |

- **Energy:** estimates agree on roughly 0.3 Wh: Google measured 0.24 Wh and [Epoch AI](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use) estimated about 0.3 Wh for GPT-4o.
- **Why not Google's 0.03 g:** it is market-based, so it credits Google's clean energy purchases. The bike figure is real emissions avoided, so 0.1 g uses the location-based factor from the same paper (345 g/kWh for 2024), before those credits.
- **"Average" is approximate:** no company publishes a mean. Google reports a median and says the distribution is skewed, so a true mean would be higher and the prompt count lower.
- **Covers text prompts only:** this leaves out training, images and video. Long inputs and reasoning models use more: Epoch estimates about 2.5 Wh for a 10,000-token input.
- **CO₂ only:** "environmental impact" here means CO₂. Water isn't compared, because there's no water saving to set against it.
