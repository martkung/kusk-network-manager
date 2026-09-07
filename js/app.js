let editId = null;

/* =========================
   IMPORTS
========================= */

import { loadSwitches }
from "./switch/loadSwitches.js";

import { addSwitch }
from "./switch/addSwitch.js";

import { updateSwitch }
from "./switch/editSwitch.js";

import { deleteSwitch }
from "./switch/deleteSwitch.js";

import { db }
from "./firebase-config.js";

import {
    doc,
    getDoc
}
from
"https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

/* =========================
   LOAD DATA
========================= */

loadSwitches();

/* =========================
   SAVE DEVICE
========================= */

export async function saveDevice(){

    try{

        const data = {

            name:
            document.getElementById("name").value.trim(),

            brand:
            document.getElementById("brand").value.trim(),

            model:
            document.getElementById("model").value.trim(),

            ip:
            document.getElementById("ip").value.trim(),

            mac:
            document.getElementById("deviceMAC").value.trim(),

            username:
            document.getElementById("username").value,

            password:
            document.getElementById("password").value,
          
            serialNumber:
            document.getElementById("serialNumber").value,

            location:
            document.getElementById("location").value,

            
            status:
            document.getElementById("status").value,

            configUrl:
            "http://" +
            document.getElementById("ip").value.trim(),

            lastSeen:
            new Date().toLocaleString()

        };

        if(!data.name){

            alert("Please enter device name");

            return;

        }

        if(editId){

            await updateSwitch(
                editId,
                data
            );

            alert(
                "Update Success"
            );

        }
        else{

            await addSwitch(
                data
            );

            alert(
                "Save Success"
            );

        }

        location.reload();

    }
    catch(error){

        console.error(error);

        alert(
            "Save Error"
        );

    }

}

window.saveDevice =
saveDevice;

/* =========================
   NEW DEVICE
========================= */

window.newDevice =
function(){

    editId = null;

    document.getElementById("name").value = "";
    document.getElementById("brand").value = "";
    document.getElementById("model").value = "";
    document.getElementById("ip").value = "";
    document.getElementById("deviceMAC").value = "";

    document.getElementById("username").value = "";
    document.getElementById("password").value = "";
    document.getElementById("serialNumber").value = "";
    document.getElementById("location").value = "";
    document.getElementById("status").value = "online";

    const modal =
    new bootstrap.Modal(
        document.getElementById(
            "deviceModal"
        )
    );

    modal.show();

};

/* =========================
   EDIT DEVICE
========================= */

window.editDevice =
async function(id){

    try{

        const docRef =
        doc(
            db,
            "switches",
            id
        );

        const snap =
        await getDoc(
            docRef
        );

        if(
            !snap.exists()
        ){

            alert(
                "Device not found"
            );

            return;

        }

        const data =
        snap.data();

        editId = id;

        document.getElementById(
            "name"
        ).value =
        data.name || "";

        document.getElementById(
            "brand"
        ).value =
        data.brand || "";

        document.getElementById(
            "model"
        ).value =
        data.model || "";

        document.getElementById(
            "ip"
        ).value =
        data.ip || "";

        document.getElementById(
            "deviceMAC"
        ).value =
        data.mac || "";

        document.getElementById(
            "username"
        ).value =
        data.username || "";

        document.getElementById(
            "password"
        ).value =
        data.password || "";

        document.getElementById(
            "serialNumber"
        ).value =
        data.serialNumber || "";

        document.getElementById(
            "location"
        ).value =
        data.location || "";

        document.getElementById(
            "status"
        ).value =
        data.status || "online";

        const modal =
        new bootstrap.Modal(
            document.getElementById(
                "deviceModal"
            )
        );

        modal.show();

    }
    catch(error){

        console.error(error);

        alert(
            "Load Device Error"
        );

    }

};

/* =========================
   DELETE DEVICE
========================= */

window.deleteDevice =
async function(id){

    if(
        !confirm(
            "Delete this switch ?"
        )
    ){
        return;
    }

    try{

        await deleteSwitch(id);

        location.reload();

    }
    catch(error){

        console.error(error);

        alert(
            "Delete Error"
        );

    }

};

/* =========================
   SAVE BUTTON BIND
========================= */

function bindSaveButton(){

    const saveBtn =
    document.getElementById(
        "saveDevice"
    );

    if(!saveBtn){

        console.log(
            "saveDevice button not found"
        );

        return;

    }

    saveBtn.removeEventListener(
        "click",
        saveDevice
    );

    saveBtn.addEventListener(
        "click",
        saveDevice
    );

    console.log(
        "Save Button Ready"
    );

}

/* =========================
   WAIT MODAL LOAD
========================= */

window.addEventListener(
    "load",
    () => {

        setTimeout(
            bindSaveButton,
            1000
        );

    }
);