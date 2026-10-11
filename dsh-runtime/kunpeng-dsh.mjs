import { parseArgs } from 'node:util';
import { boot, installFailLoud, resolveConfigPath } from '@deepseek-ai/dsh-app-boot';
installFailLoud('kunpeng-dsh');
const { values } = parseArgs({ options: { config: { type: 'string' } } });
const ctx = await boot('kunpeng-dsh', resolveConfigPath(values.config || './cordis.yml'), undefined, undefined, import.meta.url);
process.stdin.on('end', () => { void ctx.fiber.dispose().finally(() => process.exit(0)); });
