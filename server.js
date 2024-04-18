import { createClient } from "@libsql/client"
import { v4 as uuidv4 } from 'uuid'

const express = require('express')
const app = express()
const port = 3000

app.use(express.json())

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
})

let goals = []

const goalsNew = []

const tasks = [
  [
    '04-17-2024',
    {
      id: 1,
      title: 'Module 11 homework',
      date: '04-17-2024',
      description: 'Read chapters and discuss with group',
      completed: false,
      categoryId: 1
    },
    {
      id: 2,
      title: 'Email professor about extra credit',
      date: '04-17-2024',
      description: '',
      completed: false,
      categoryId: 1
    }
  ],
  [
    '04-18-2024',
    {
      id: 3,
      title: 'Set up girls lunch',
      date: '04-18-2024',
      description: 'Remember to invite Jessica, Mikell, and Avery',
      completed: false,
      categoryId: 5
    }
  ]
]

// Test route
app.get('/testing', async (req, res) => {
  res.send({Hello:'World'})
})

// List tasks
app.get('/tasks', (req, res) => {
  res.send(tasks)
})

// List goals
app.get('/goals', (req, res) => {
  res.send(goals)
})

// Update goal
app.put('/goals/:id', async (req, res) => {
  const result = await client.execute({
    sql: `UPDATE Goal
          SET title=?, description=?, frequency=?, quantity=?, category=?
          WHERE id=?`,
    args: [
      req.body.title,
      req.body.description,
      req.body.frequency,
      req.body.quantity,
      req.body.category,
      req.params.id
    ]
  })
  console.log(result)
  await loadFromDatabase()
  
  // Send a response based on success or failure
  if (result.rowsAffected == 1) {
    res.send({message: 'Success'})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Create goal
app.post('/goals', async (req, res) => {
  // Creat a UUID
  let newUuid = uuidv4()

  // Send to the database
  const result = await client.execute({
    sql: `INSERT INTO Goal VALUES(?,?,?,?,?,?)`,
    args: [
      newUuid,
      req.body.title,
      req.body.description,
      req.body.frequency,
      req.body.quantity,
      req.body.category
    ]
  })

  // Reload the data
  await loadFromDatabase()

  // Send a response based on success or failure
  if (result.rowsAffected == 1) {
    res.status(201).send({message: 'Success', id: req.params.id})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Delete goal
app.delete('/goals/:id', async (req, res) => {
  // Delete from database
  const result = await client.execute({
    sql: `DELETE FROM Goal WHERE id=?`,
    args: [req.params.id]
  })

  // Reload data from database for reading
  await loadFromDatabase()

  // Send a response
  if (result.rowsAffected == 1) {
    res.send({message: `Deleted goal with id ${req.params.id}`})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// // Get goalComplete
// app.get('/goalComplete/:id/:date', async (req, res) => {
//   // Check database to see if
// })

// Update goalComplete
app.put('/goalcomplete/:id/:date', async (req, res) => {
  // Check database to see if update or create
  let completeResult = await client.execute({
    sql: 'SELECT completed FROM goalComplete WHERE goalId=? AND date=?',
    args: [req.params.id, req.params.date]
  })
  
  // If an entry for today doesn't exist, create a record
  let result
  if (completeResult.rows.length === 0) {
    result = await client.execute({
      sql: 'INSERT INTO goalComplete VALUES (?,?,?)',
      args: [
        req.params.id,
        req.params.date,
        req.body.completed
      ]
    })
  } else {
    // Else update the record
    result = await client.execute({
      sql: `UPDATE goalComplete
            SET completed=?
            WHERE goalId=?`,
      args: [
        req.body.completed,
        req.params.id
      ]
    })
  }

  await loadFromDatabase()
  if (result.rowsAffected == 1) {
    res.send({message: 'Success', newCompleted: req.body.completed})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

async function loadFromDatabase() {
  // Retrieve the goals from the database
  let goalResult = await client.execute('SELECT * FROM Goal')
  let goalsTemp = {}
  let dataRowFormatted = {}

  // Put the results into an object sorted by category
  for (let dataRow of goalResult.rows) {
    dataRowFormatted = {
      id: dataRow.id,
      title: dataRow.title,
      description: dataRow.description,
      frequency: dataRow.frequency,
      quantity: dataRow.quantity,
      category: dataRow.category.toString()
    }

    // Retrieve goal completion number for today, if it exists
    let today = new Date()
    let completeResult = await client.execute({
      sql: 'SELECT completed FROM goalComplete WHERE goalId=? AND date=?',
      args: [dataRowFormatted.id, today.toDateString()]
    })
    if (completeResult.rows.length === 0) {
      dataRowFormatted.completed = 0
    } else {
      dataRowFormatted.completed = completeResult.rows[0].completed
    }

    if (Object.hasOwn(goalsTemp, dataRow.category)) {
      goalsTemp[dataRow.category].push(dataRowFormatted)
    } else {
      goalsTemp[dataRow.category] = [dataRowFormatted]
    }
  }

  // Turn it into the list format the client needs
  goals = []
  for (const property in goalsTemp) {
    let categoryArr = []
    categoryArr.push(property)
    for (const dataItem of goalsTemp[property]) {
      categoryArr.push(dataItem)
    }
    goals.push(categoryArr)
  }
}

app.listen(port, async () => {
  console.log('Loading data from database...')
  await loadFromDatabase()

  console.log(`Server listening on port ${port}`)
})

/* Elephant graveyard */
/*

  // for (let i = 0; i < goals.length; i++) {
  //   for (let j = 0; j < goals[i].length; j++) {
  //     if (Object.hasOwn(goals[i][j], 'id') && goals[i][j].id == req.body.id) {
  //       goals[i][j] = req.body
  //       console.log(`Done! Goal is now ${JSON.stringify(goals[i][j])}`)
  //     }
  //   }
  // }
  // console.log(JSON.stringify(goals))


  //   [
//     'School',
//     {
//       id: 1,
//       title: 'Get A\'s this semester',
//       description: 'Get my GPA up to 3.85',
//       frequency: 'once',
//       quantity: 1,
//       categoryId: 1
//     },
//     {
//       id: 2,
//       title: 'Finish homework before Netflix',
//       description: '',
//       frequency: 'daily',
//       quantity: 1,
//       categoryId: 1
//     }
//   ],
//   [
//     'Physical',
//     {
//       id: 3,
//       title: 'Take a walk twice a day',
//       description: 'At least a quarter mile!',
//       frequency: 'daily',
//       quantity: 2,
//       categoryId: 5
//     }
//   ]


*/