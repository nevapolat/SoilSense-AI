# SoilSense AI: Regenerative Agriculture & Smart Waste Management System

## Problem definition

Globally, a large share of agricultural soils are degraded due to excessive chemical use and improper irrigation. Small to mid-sized farmers face rising fertilizer costs and climate uncertainty, which threatens food security and accelerates ecological stress.

## User persona (target audience)

- **Subsistence and smallholder farmers:** Need to cut input costs (fertilizer, water) while keeping yields viable.
- **Local governments & communities:** Running collective composting or sustainable land-use programs.
- **Conscious growers / agritech-minded producers:** Want practical, regenerative guidance without expensive hardware.

## Role of AI in the project

SoilSense uses a **large language model (Anthropic Claude via API)** to turn farmer inputs—soil type, location, activities, optional images, and weather context—into **actionable, localized guidance**:

- Regenerative and soil-health recommendations (alternatives to over-reliance on chemicals).
- Compost and organic-input suggestions aligned with available materials.
- Daily tasks, alerts, and short explanations adapted to the user’s language (i18n).

The app combines **structured logic** (validation, Open-Meteo signals, field planning helpers) with **Claude-generated text and JSON-shaped outputs** so recommendations stay readable and implementable on the farm.

## Competitor analysis & our edge

- **Competitors:** Corporate agritech tools that are costly and often optimized for industrial-scale data, not the smallest producers.
- **Our edge:** Democratized access—practical regenerative guidance without mandatory sensors, using AI plus simple profile and location data.

## Success criteria (MVP)

- Location-aware soil restoration / guidance content.
- Compost-oriented recommendations grounded in user inventory and context.
- Climate- and season-aware hints for planting, tasks, and risk awareness.
