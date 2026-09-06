import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';

type TocItem = {
  id: string;
  label: string;
};

const TOC: TocItem[] = [
  { id: 'agents', label: 'For agents' },
  { id: 'what', label: 'What this is' },
  { id: 'install', label: 'Install' },
  { id: 'registry', label: 'Connect a registry' },
  { id: 'registries-work', label: 'How registries work' },
  { id: 'website', label: 'Open the website' },
  { id: 'find', label: 'Find a resource' },
  { id: 'install-one', label: 'Install one thing' },
  { id: 'batch', label: 'Install several at once' },
  { id: 'harnesses', label: 'Pick harnesses' },
  { id: 'update', label: 'Update and remove' },
  { id: 'cli', label: 'CLI cheat sheet' },
  { id: 'types', label: 'Resource types' },
  { id: 'broken', label: 'If something breaks' },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-3 flex max-w-[68ch] flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

const AGENT_PROMPT = `Set up AI Directory on this machine.

Do these steps in order. Stop and tell me if any step fails.

1. Check Node: run "node --version". You need version 24 or later. Tell me if it is older.
2. Install the tool: run "npm install --global @jmrbdev/ai-directory".
3. Check it works: run "aid --help".
4. Connect the registry: run "aid setup --repository git@github.com:you/ai-directory-registry.git --non-interactive". If setup asks questions, answer with the defaults.
5. Check the setup: run "aid doctor". The registry must show as reachable.
6. See what is there: run "aid list" and show me the resource names.
7. Ask me which resources I want, then install them with "aid install <id> --harness <harness>".

Do not skip the doctor check. Do not guess resource names, always list first.`;

function AgentPrompt() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(AGENT_PROMPT);
      setCopied(true);
      toast.success('Prompt copied.');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      toast.error('Could not copy the prompt.');
    }
  }

  return (
    <div className="relative rounded-md border bg-muted/50">
      <div className="absolute top-2 right-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Copy agent prompt" onClick={() => void copy()} />
            }
          >
            {copied ? <HugeiconsIcon icon={Tick02Icon} /> : <HugeiconsIcon icon={Copy01Icon} />}
          </TooltipTrigger>
          <TooltipContent>{copied ? 'Copied' : 'Copy agent prompt'}</TooltipContent>
        </Tooltip>
      </div>
      <pre className="overflow-x-auto px-3 py-2 pr-12 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {AGENT_PROMPT}
      </pre>
    </div>
  );
}

export function DocsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Docs</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">
          Install the tool, connect a registry, and put resources into your coding harnesses. That is the whole loop.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label="On this page" className="lg:sticky lg:top-20">
          <Card size="sm">
            <CardHeader>
              <CardTitle>On this page</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-row flex-wrap gap-1 lg:flex-col lg:items-stretch">
              {TOC.map((item) => (
                <Button key={item.id} variant="ghost" size="sm" className="justify-start" render={<a href={`#${item.id}`} />}>
                  {item.label}
                </Button>
              ))}
            </CardContent>
          </Card>
        </nav>

        <div className="flex min-w-0 flex-col gap-10">
          <Section id="agents" title="For agents">
            <p>Paste this into your coding agent and let it do the setup for you. Replace the registry address with yours.</p>
            <AgentPrompt />
          </Section>

          <Section id="what" title="What this is">
            <p>
              AI Directory keeps a catalog of small, reusable files: skills, agents, rules, MCP servers, packs, plugins,
              and tools. You pick what you want and it copies the files into your coding harness folders.
            </p>
            <p>Two parts, one machine: the <code className="font-mono text-xs">aid</code> command and the local website it serves.</p>
          </Section>

          <Section id="install" title="Install">
            <p>You need Node 24 or later. For daily use, install once. The command is called <code className="font-mono text-xs">aid</code>:</p>
            <Code>{`npm install --global @jmrbdev/ai-directory\naid --help`}</Code>
            <p>To try it once without installing, put <code className="font-mono text-xs">npx</code> in front. Same flags.</p>
            <Code>{`npx @jmrbdev/ai-directory --help`}</Code>
          </Section>

          <Section id="registry" title="Connect a registry">
            <p>The catalog lives in a Git repo. Point the tool at it once:</p>
            <Code>{`aid setup --repository git@github.com:you/ai-directory-registry.git --non-interactive`}</Code>
            <p>Change it later in Settings, or check it any time with <code className="font-mono text-xs">aid doctor</code>.</p>
          </Section>

          <Section id="registries-work" title="How registries work">
            <p>
              A registry is a plain Git repo: an <code className="font-mono text-xs">index.json</code> file at the root
              plus one folder per resource version. The repo owner decides what gets in. There are no direct uploads.
            </p>
            <p>
              To add or change something, open a pull request against the registry repo. A maintainer reviews it,
              merges it, and the change goes live on the next read. Run this before you open the PR:
            </p>
            <Code>{`aid check --repository .`}</Code>
            <p>
              Maintainers can run the same command as a merge check in CI, so broken structure never lands on main.
              Each resource carries a review badge: Unreviewed means nobody with write access has looked at it yet,
              Reviewed means a maintainer approved it. Retired resources stay in history but leave the catalog.
            </p>
            <p>If you run a shared registry, keep the rule simple: nothing merges without a human review and a green check.</p>
          </Section>

          <Section id="website" title="Open the website">
            <p>The website runs on your own machine. No hosting, no account, no login.</p>
            <Code>{`aid web --open`}</Code>
            <p>It opens in your browser and talks to the local server directly.</p>
          </Section>

          <Section id="find" title="Find a resource">
            <p>
              The Catalog lists everything by type. Use search, the reviewed filter, and sorting to narrow it down.
              Open a card to read what it does and which files it will copy.
            </p>
          </Section>

          <Section id="install-one" title="Install one thing">
            <p>On a catalog card, press Add. On a resource page, press Add to batch. Both do the same thing.</p>
            <p>Or use the terminal for a single install:</p>
            <Code>{`aid install octocat/skills/typescript-api-review --harness claude-code`}</Code>
          </Section>

          <Section id="batch" title="Install several at once">
            <p>
              Add more than one resource, then open Batch in the top bar. One press installs everything in order.
              If one item fails, the batch stops there so you can see what went wrong.
            </p>
            <p>The same works in the terminal. List each resource after the last:</p>
            <Code>{`aid install owner/skills/one owner/rules/two --harness claude-code`}</Code>
          </Section>

          <Section id="harnesses" title="Pick harnesses">
            <p>Each item in the batch can go to different harnesses. A skill can go to Codex while a rule goes to OpenCode.</p>
            <p>Edit harnesses in the Batch drawer, on any row, or on the resource page. They stay in sync.</p>
            <p>New items start with your default harnesses from Settings. Clearing every harness removes the row.</p>
          </Section>

          <Section id="update" title="Update and remove">
            <p>Open a resource you already installed. The panel shows an Installed here tab with one row per harness.</p>
            <p>Each row shows the installed version and offers Update or Reinstall only when needed. Uninstall everywhere removes all of them.</p>
            <Code>{`aid update owner/skills/one --harness claude-code\naid uninstall owner/skills/one --harness claude-code`}</Code>
          </Section>

          <Section id="cli" title="CLI cheat sheet">
            <div className="flex flex-col gap-2">
              {[
                ['aid list', 'List everything in the registry'],
                ['aid show owner/type/name', 'Show one resource and its files'],
                ['aid install … --harness …', 'Install one or more resources'],
                ['aid update …', 'Move an installed resource to the latest version'],
                ['aid uninstall …', 'Remove an installed resource'],
                ['aid installed', 'Show what is installed on this machine'],
                ['aid harness list', 'Show your coding harnesses'],
                ['aid web --open', 'Open the local website'],
                ['aid doctor', 'Check setup and registry access'],
              ].map(([command, meaning]) => (
                <div key={command} className="flex flex-col gap-1 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <code className="font-mono text-xs">{command}</code>
                  <span className="text-xs">{meaning}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="types" title="Resource types">
            <div className="flex flex-wrap gap-2">
              {[
                ['Skill', 'Reusable instructions'],
                ['Agent', 'A reusable specialist'],
                ['Rule', 'Guidance for coding work'],
                ['MCP Server', 'A Model Context Protocol server'],
                ['Resource pack', 'A pack of existing resources'],
                ['Plugin', 'A self-contained bundle'],
                ['Tool', 'A command-line tool'],
              ].map(([label, meaning]) => (
                <span key={label} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
                  <Badge variant="secondary">{label}</Badge>
                  {meaning}
                </span>
              ))}
            </div>
            <p>
              Plugins and tools can hold files for several harnesses at once. Templates expand into their member
              resources when you install them.
            </p>
          </Section>

          <Section id="broken" title="If something breaks">
            <p>Start here. It tells you if the registry is reachable and which harnesses it can see:</p>
            <Code>{`aid doctor`}</Code>
            <p>If the catalog looks stale, use the refresh button in the top bar. If files changed on disk, the resource page will offer Reinstall.</p>
            <p>
              Still stuck? Go to <Link to="/" className="underline underline-offset-4">the catalog</Link> and try one small install first.
            </p>
          </Section>

          <Separator />
          <p className="max-w-[68ch] text-xs text-muted-foreground">
            That is everything you need to start. Install the package, connect a registry, add a few resources to a batch.
          </p>
        </div>
      </div>
    </div>
  );
}
