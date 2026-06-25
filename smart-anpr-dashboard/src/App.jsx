import { useState } from "react";
import AppRouter from "./router/AppRouter";
import Splash from "./components/Splash";

function App() {
  const [ready, setReady] = useState(false);
  return ready ? <AppRouter /> : <Splash onDone={() => setReady(true)} />;
}

export default App;
