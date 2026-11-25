# HOWTO: deploy the fleet stack to a fresh Azure VM

One VM runs the model gate (buckle + litellm engine), the durable
supervisor + lanes, and the Gondolin sandbox; the GUI runs as a
Container App in front of AFD/WAF. **No public IP on the VM — ever**
(advisory): external access rides the Container App (UI) and the
central APIM/AFD; ops ride Bastion.
Proven shape: `flock-runner-0` (Standard_D8as_v6, 8 vCPU/31GB, Ubuntu,
westeurope, subscription `0f381e64-df07-4394-97dd-94f28568f480`,
RG `rg-flock-nonprod`).

## 1. VM

```bash
az vm create -g rg-flock-nonprod -n flock-runner-0 --size Standard_D8as_v6 \
  --image Canonical:ubuntu-24_04-lts:server:latest --admin-username flockadmin \
  --ssh-key-values ~/.ssh/id_ed25519.pub --nsg ""          # policy blocks auto-NSG: attach your own after
az network nic update -g rg-flock-nonprod -n flock-runner-0VMNic --network-security-group <nsg-id>
```

- **D8as_v6 or any AMD EPYC with nested virt** — Gondolin runs libkrun
  (`/dev/kvm`), **never QEMU**. Verify: `ls -la /dev/kvm` (group `kvm`).
- Install: `docker.io` + `docker-compose-v2`, `zram-tools`,
  `linux-modules-extra-$(uname -r)` (zram module on the Azure kernel).
- **Do not attach a public IP** (org advisory). Ops SSH via Bastion
  (`flock-bastion`, Developer SKU); the supervisor must publish
  `7780:7780` so the GUI Container App can reach the board privately.

## 2. GUI — Container App + AFD

The GUI is a BFF: one public entry (AFD/WAF → Container App), private
east-west calls to the VM's gate `:4111` + supervisor `:7780`.

```bash
az network vnet subnet create -g rg-flock-nonprod --vnet-name vnet-flock-nonprod \
  -n snet-containerapps --address-prefixes 10.50.2.0/23 --delegations "Microsoft.App/environments"
az containerapp env create -g rg-flock-nonprod -n flock-gui-env -s <subnet-id>          # ~10 min
az containerapp create -g rg-flock-nonprod -n flock-gui --environment flock-gui-env \
  --image ghcr.io/klh/fleet-buckle-gui:latest --registry-server ghcr.io --registry-username klh \
  --registry-password <PAT> --target-port 8080 --ingress external \
  --secrets gui-key=… sup-token=… buckle-admin-key=… \
  --env-vars BUCKLE_URL=http://10.50.0.5:4111 SUPERVISOR_URL=http://10.50.0.5:7780 \
    GUI_MODE=production GUI_PORT=8080 GUI_KEY=secretref:gui-key \
    SUPERVISOR_TOKEN=secretref:sup-token BUCKLE_ADMIN_KEY=secretref:buckle-admin-key
```

AFD fronts `flock-gui--<suffix>.<env-domain>.azurecontainerapps.io`
(path base `/fleet-buckle-gui/*`, SSE unbuffered, WAF learning mode
first). After AFD is live, restrict the Container App ingress to the
AFD backend IP ranges. Runners/factory faces: `/api/runners.json` lists
armed watchers + settled agents + live lanes (deep-link
`/app/runner-detail?runner=<uuid>`).

## 2. Model accounts (the 12)

Two accounts in the RG (see `AGENTS.md` "Azure models" for the model list):

- `fleet-buckle-openai` (kind OpenAI): 9 gpt deployments.
- `fleet-buckle-multi2` (kind AIServices): Kimi / mistral / gpt-oss
  (+ `Microsoft-Decision-1.1` if the platform ever routes it).

**Capacity is thousands of tokens/min**: `--sku-capacity 50` = 50k TPM.
`capacity 1` = 1k TPM and every lane starves on 429s — observed live.
Multi-account models serve via the **regional gateway**
`https://westeurope.api.cognitive.microsoft.com/` (NOT the account
endpoint, which has no DNS) with `api-version=2024-10-21`.

Keys go in `/opt/buckle/.env` (paths/values only there):
`AZURE_API_KEY/AZURE_API_BASE`, `AZURE_MULTI_API_KEY/AZURE_MULTI_API_BASE`,
`ZAI_API_KEY` (glm leg), `ENGINE_MASTER_KEY`.

## 3. Stack

```bash
mkdir -p /opt/buckle && tar xzf buckle-tree.tgz -C /opt/buckle
tar xzf buckle-state.tgz -C /var/lib/docker/volumes   # buckle_state (keys) + buckle_fleet-state (journals)
# images: docker load (buckle), docker pull ghcr + retag (worker, gui)
chown -R 1000:1000 /var/lib/docker/volumes/buckle_*   # lanes run as uid 1000 — else EACCES mkdir /workspace
docker compose -f /opt/buckle/compose.yaml up -d
```

Gotchas paid for in blood:

| symptom | cause | fix |
|---|---|---|
| lanes fail instantly, no journal rows | volumes root-owned after tar | `chown 1000:1000` |
| 429 storm mid-run | deployment TPM too small | `--sku-capacity 50` |
| empty model content, 0 tokens | stale 2800-entry journals replayed | wipe `clone-*.sqlite` for fresh runs |
| `azure/X is not served` | engine restarted mid-catalog-pull | restart engine, re-probe |
| mind crash-loop | spawn env lacked charter/token | fixed in fleet-worker ≥ `591667f` |
| `/dev/kvm` denied in container | kvm gid not in `group_add` | `group_add: ["109"]` (host gid) |

## 4. Gondolin on libkrun (no QEMU)

Supervisor service in compose needs:

```yaml
environment:
  GONDOLIN_VMM: krun              # gondolin reads this env
  WORKER_EXECUTOR: gondolin
  LD_LIBRARY_PATH: /usr/local/lib/krun
devices:  [/dev/kvm]
group_add: ["109"]                 # host kvm gid
volumes:
  - /opt/buckle/worker/krun-runner:/app/krun-runner:ro
  - /opt/buckle/worker/krun-runner/lib:/usr/local/lib/krun:ro
```

The runner binary comes from the npm package
`@earendil-works/gondolin-krun-runner-linux-x64` (extract
`bin/gondolin-krun-runner` + `lib/*.so*`). Guest images (e.g.
`alpine-base:0.5.0`) pull from the gondolin builtin registry and
include krun assets; cache lands in `XDG_CACHE_HOME=/gcache`.

Smoke test inside the supervisor container:
`bun -e '... VM.create({ sandbox: { vmm: "krun", imagePath: "alpine-base:0.5.0" } }) ... exec(["uname","-a"])'`
→ `Linux (none) 6.12.x x86_64`.

## 5. Permanent repo watcher

`SUPERVISOR_REPO: icomdev/Vanilla-JavaScript-Calculator` on the
supervisor service — it auto-imports open issues as tasks
(dupe-guarded per repo+issue, PR-reference guarded), spawns clone
lanes, and drives them to PRs. Model pin lives in
`/opt/buckle/worker/.prefer` (`prefer=azure/gpt-6.1-sol,...`).
Verified: issue #122 → PR #123, one attempt, no human touch.

## 6. Verify

```bash
K=$(docker exec buckle-buckle-1 cat /state/keys/principal.worker@azure.key)
curl -s -H "authorization: Bearer $K" localhost:4111/v1/models          # catalog
curl -s -H "authorization: Bearer $K" localhost:4111/v1/chat/completions -d '{...}'  # chat
curl -s https://<container-app>/api/factory.json                        # live wall
curl -s -H "authorization: Bearer <supervisor_token>" 10.50.0.5:7780/board
```

Bastion Developer (`flock-bastion`) rides the Azure fabric — use the
portal SSH or `az network bastion ssh --target-resource-id <vm-id>`
(the CLI SSH can hang on flaky local networks; the portal path works).
Access still needs PIM Contributor on the RG for any `az` changes.
