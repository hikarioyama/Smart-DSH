# dsh-omp-tasks

OMP-style task delegation for DeepSeek Harness: the parent agent spawns named subagents,
each confined to one role, and reports arrive through a sibling hub as one-line `MiL` facts.

Self-contained DSH bundle (host + web client, no runtime dependencies).

> Status: verified against DSH `0.1.2-rc.1` with `node --test tests/*.test.mjs`;
> the unit suite covers the tool policy, the MiL reporter, and both bundle halves.

## Roles (one exclusive verb each)

| Role | Verb | Tools denied |
|---|---|---|
| `worker` | edit the paths the assignment names, and check the change | ask_user_question, task tools, spawning siblings; bash writes outside the named paths |
| `explorer` | measure what is written | write and edit; bash writes, GPU start/stop |
| `hacker` | attack the assignment's premises; produce exactly three hacks in MiL, no experiments | write and edit |
| `reviewer` | judge the assigned diff against the assignment, citing `loc:=path:line` | write, edit, bash |

Children never see the parent conversation: the assignment is the whole task. The launch
is refused unless the assignment names concrete paths (for `worker`) or exists at all.
`ask_user_question` inside a child is refused and logged; children do not notify — report
flow goes through the hub to the roster address, and the parent's web UI shows the hub
stream in the subagent conversation tab.

## Report discipline (MiL)

Reports must satisfy the `MIL_NORM` line bundled in `lib/core.js`
(`fm:from=host; del(recoverable); IF:=cond; ¬infer; amb→qmin`). Non-MiL text is rejected
with `report:=∅ ∵ ¬MiL` and the child is nudged once (`MIL_REPORT_NUDGE`) to restate.
Natural language only ever appears inside quotes.

## Install

The bundle has no runtime dependency, so the `pnpm add` step `dsh-notify-push` needs does
not apply — the registration shape matches `dsh-esc-stop` exactly (`-w` because the
profile is a pnpm workspace root, then the layer list is edited directly):

```bash
BUNDLE_SRC="$HOME/.dsh/profiles/web/bundles-src/dsh-omp-tasks"
git clone https://github.com/hikarioyama/Smart-DSH.git /tmp/Smart-DSH
mkdir -p "$(dirname "$BUNDLE_SRC")" && cp -r Smart-DSH/dsh-omp-tasks "$BUNDLE_SRC"
cd ~/.dsh/profiles/web && dsh plugin --profile web add "$BUNDLE_SRC" -w
node -e 'const fs=require("fs"),p=process.env.HOME+"/.dsh/profiles/web/package.json",m=JSON.parse(fs.readFileSync(p,"utf8")),b=m.dsh.profile.bundles;if(!b.includes("dsh-omp-tasks"))b.push("dsh-omp-tasks");fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n")'
dsh --profile web --dump-config | grep dsh-omp-tasks   # read-only composition check
systemctl --user restart dsh-web.service              # never from the session being restarted
```

Run the unit suite from **inside the profile** (`$BUNDLE_SRC` lives under
`~/.dsh/profiles/web/bundles-src/`, so node resolves the hoisted
`@deepseek-ai/*` host packages there; a bare clone cannot run the host-half
suite until the bundle is registered):

```bash
cd "$BUNDLE_SRC" && node --test tests/*.test.mjs    # 25 tests
```

State lives at `$DSH_HOME/omp-tasks/` (mode `0700`, durable task logs) and agent role
prompts at `$DSH_HOME/agents/` (0700). Nothing here is wired to a specific user.
