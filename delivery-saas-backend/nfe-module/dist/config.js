"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function loadConfig(cfgPath) {
    // Default to a config.json located inside the nfe-module folder next to this file.
    // This makes the module resolve its config regardless of process.cwd().
    const defaultPath = path_1.default.join(__dirname, '..', 'config.json');
    const p = cfgPath
        ? (path_1.default.isAbsolute(cfgPath) ? cfgPath : path_1.default.join(process.cwd(), cfgPath))
        : defaultPath;
    if (!fs_1.default.existsSync(p))
        throw new Error(`Config file not found: ${p}. Copy config.sample.json to config.json and edit.`);
    const raw = fs_1.default.readFileSync(p, 'utf8');
    return JSON.parse(raw);
}
