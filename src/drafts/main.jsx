import { createRoot } from "react-dom/client";

import { FoldScrollDraft } from "./FoldScrollDraft";
import "../styles/base.css";
import "../styles/controls.css";
import "../styles/scene.css";
import "./fold-scroll.css";

const root = createRoot(document.getElementById("root"));
root.render(<FoldScrollDraft />);
