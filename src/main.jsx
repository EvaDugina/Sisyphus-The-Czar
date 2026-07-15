import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/base.css";
import "./styles/controls.css";
import "./styles/scene.css";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
