import { db } from "../firebase-config.js";

import {
deleteDoc,
doc
}
from
"https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

export async function deleteSwitch(id){

await deleteDoc(
doc(db,"switches",id)
);

}