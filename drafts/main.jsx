import { createRoot } from "react-dom/client";

import { FoldScrollDraft } from "./FoldScrollDraft";
import "../src/styles/base.css";
import "../src/styles/controls.css";
import "../src/styles/scene.css";
import "./fold-scroll.css";

const root = createRoot(document.getElementById("root"));
root.render(<FoldScrollDraft />);
