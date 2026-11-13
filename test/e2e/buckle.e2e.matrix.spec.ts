// e2e — PROJECT 2 (depends on smoke): the MITM loop + the federation
// matrix through the real Docker Desktop stack. The matrix (the spec):
//
//   alice-key → b1: openrouter ONLY          bob-key → b1: openrouter+zai
//   carol-key → b1: all three                carol-key → b2: copilot+zai
//   carol-key → b3: zai only                 bob-key → b2: 403 problem+json
//
// Lands with the server commits (3-5). Rides the same global stack as
// smoke (docker only — no local mode).
import { test } from "@playwright/test";

test.skip(true, "the buckle server lands in commit 3; the matrix rides behind it");
