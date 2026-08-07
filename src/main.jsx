import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SettingsPage } from "./SettingsPage";
import "./styles/base.css";
import "./styles/controls.css";
import "./styles/fold.css";
import "./styles/scene.css";

const root = createRoot(document.getElementById("root"));
const isSettingsPage = window.location.pathname.replace(/\/+$/, "") === "/settings";
root.render(isSettingsPage ? <SettingsPage /> : <App />);
