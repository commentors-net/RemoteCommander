import { describe, it, expect } from 'vitest';
import { extractInteractiveChoices } from '../src/client/options.js';

describe('extractInteractiveChoices', () => {
  it('extracts natural Option A, Option B, Option C with reply phrases', () => {
    const text = `I tried to list /home/cpaneluser but the website file tool is restricted to the website root and can’t access that path. Tell me which you prefer and I’ll proceed:
- Option A — I check it for you on the server (I will run read-only commands like ls/stat). Reply “yes — check /home/cpaneluser” to authorize and confirm this is safe (and whether this is a production server).
- Option B — you run one of these quick commands and paste the output:
  - ls -lh /home/cpaneluser/update-2026-v1.zip
- Option C — if you uploaded the zip under the website root (e.g., public_html or a subfolder), tell me the relative path.
Which option do you want`;

    const choices = extractInteractiveChoices(text);
    expect(choices.length).toBe(3);
    expect(choices[0].label).toContain('Option A');
    expect(choices[0].value).toBe('yes — check /home/cpaneluser');
    expect(choices[1].label).toContain('Option B');
    expect(choices[2].label).toContain('Option C');
  });

  it('extracts bracketed options directly', () => {
    const text = `I found update-2026-v1.zip in your home directory. How would you like to proceed?
- [Option A: Extract into public_html]
- [Option B: Inspect contents first]
- [No, cancel]`;

    const choices = extractInteractiveChoices(text);
    expect(choices.length).toBe(3);
    expect(choices[0].label).toBe('Option A: Extract into public_html');
    expect(choices[0].value).toBe('Option A: Extract into public_html');
    expect(choices[2].variant).toBe('danger');
  });

  it('extracts Yes/No confirmation prompts', () => {
    const text = 'Do you want me to proceed with extracting this archive into public_html? Reply "yes" to proceed.';
    const choices = extractInteractiveChoices(text);
    expect(choices.length).toBe(2);
    expect(choices[0].label).toBe('Yes, proceed');
    expect(choices[0].value).toBe('Yes, please proceed');
    expect(choices[0].variant).toBe('primary');
    expect(choices[1].label).toBe('No, cancel');
    expect(choices[1].variant).toBe('danger');
  });

  it('extracts numbered options in choice contexts', () => {
    const text = `Please select an option to continue:
1. Extract into public_html
2. Extract into custom subfolder
3. Cancel operation`;

    const choices = extractInteractiveChoices(text);
    expect(choices.length).toBe(3);
    expect(choices[0].label).toBe('1. Extract into public_html');
    expect(choices[2].variant).toBe('danger');
  });

  it('extracts path options and server suggestions', () => {
    const text = `On this server, your actual account home is /home/cpaneluser. Which path would you like to use?
- [Use Website Root: /home/cpaneluser/public_html]
- [Use Account Home: /home/cpaneluser]
- [Cancel]`;

    const choices = extractInteractiveChoices(text);
    expect(choices.length).toBe(3);
    expect(choices[0].label).toBe('Use Website Root: /home/cpaneluser/public_html');
    expect(choices[1].label).toBe('Use Account Home: /home/cpaneluser');
    expect(choices[2].variant).toBe('danger');
  });

  it('returns empty array when no choices are presented', () => {
    const text = 'PM2 is running with 3 applications active. System memory usage is at 45%.';
    const choices = extractInteractiveChoices(text);
    expect(choices.length).toBe(0);
  });
});
