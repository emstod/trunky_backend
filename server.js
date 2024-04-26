import { createClient } from "@libsql/client"
import { v4 as uuidv4 } from 'uuid'
import morgan from 'morgan'

const express = require('express')
const app = express()
const port = 3000

app.use(express.json())
app.use(morgan('tiny'))

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
})

let goals = []
let tasksByCategory = []
let tasksByDate = []

async function getCompletionDate(date, goalId) {
  // Get the frequency
  const idResult = await client.execute({
    sql: `SELECT frequency FROM Goal WHERE id=?`,
    args: [goalId]
  })
  const frequency = idResult.rows[0].frequency

  // Calculate the correct date to send based on goal frequency
  let completionDate = ''
  //const today = new Date()
  switch (frequency) {
    case 'daily':
      // If the goal is daily, use original date
      completionDate = date.toDateString()
      break
    case 'weekly':
      // If the goal is weekly, use the date of the previous Sunday
      let todayMillis = date.getTime()
      let daysFromSunday = 0
      // Switch on the day of the week
      switch (date.getDay()) {
        case 1: // Monday
          daysFromSunday = 1
          break
        case 2:
          daysFromSunday = 2
          break
        case 3:
          daysFromSunday = 3
          break
        case 4:
          daysFromSunday = 4
          break
        case 5:
          daysFromSunday = 5
          break
        case 6:
          daysFromSunday = 6
          break
      }
      // Calculate the milliseconds for the previous Sunday and get the date string
      const millisPerDay = 24 * 60 * 60 * 1000
      const millisToSend = todayMillis - (daysFromSunday * millisPerDay)
      completionDate = new Date(millisToSend).toDateString()
      break
    case 'monthly':
      // Set the date to the first of the month
      date.setDate(1)
      completionDate = date.toDateString()
  }
  return completionDate
}

// Test route
app.get('/testing', async (req, res) => {
  res.send({Hello:'World'})
})

// List goals
app.get('/goals', async (req, res) => {
  // For list grouped by category, send the goals object already stored
  if (req.query.listtype == 'category')  {
    res.send(goals)
  } else if (req.query.listtype == 'none') {
    // For uncategorized list, check first if we are looking for only daily goals
    if (req.query.frequency == 'daily') {
      let today = new Date()
      let todayStr = today.toDateString()
      let allDaily = await client.execute(`SELECT id, title, description, frequency, quantity, category
                                            FROM Goal
                                            WHERE frequency="daily"`)

      const formattedData = []
      for (let row of allDaily.rows) {
        formattedData.push({
          id: row.id,
          title: row.title,
          description: row.description,
          frequency: row.frequency,
          quantity: row.quantity,
          category: row.category
        })
      }

      // Get goal completed information
      for (let row of formattedData) {
        let response = await client.execute({
          sql: 'SELECT completed FROM goalComplete WHERE goalId=? AND date=?',
          args: [row.id, todayStr]
        })
        if (response.rows.length === 0) {
          row.completed = 0
        } else {
          row.completed = response.rows[0].completed
        }
      }
      res.send(formattedData)
      return
    }
    const result = await client.execute('SELECT * FROM Goal')
  
    // Format result
    const formattedData = []
    for (let dataRow of result.rows) {
      let dataRowFormatted = {
        id: dataRow.id,
        title: dataRow.title,
        description: dataRow.description,
        frequency: dataRow.frequency,
        quantity: dataRow.quantity,
        category: dataRow.category.toString()
      }
      formattedData.push(dataRowFormatted)
    }

    res.send(formattedData)
  }
})

// Read one goal
app.get('/goals/:id', async (req, res) => {
  let response = await client.execute({
    sql: 'SELECT * FROM Goal WHERE id=?',
    args: [req.params.id]
  })

  const row = response.rows[0]

  const formattedResponse = {
    id: row.id,
    title: row.title,
    description: row.description,
    frequency: row.frequency,
    quantity: row.quantity,
    category: row.category
  }

  // Get goal completed information
  const completionDate = await getCompletionDate(new Date(), req.params.id)
  response = await client.execute({
    sql: 'SELECT completed FROM goalComplete WHERE goalId=? AND date=?',
    args: [req.params.id, completionDate]
  })
  if (response.rows.length === 0) {
    formattedResponse.completed = 0
  } else {
    formattedResponse.completed = response.rows[0].completed
  }

  res.send({goal: formattedResponse})
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
  await loadGoalsFromDatabase()
  
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
  await loadGoalsFromDatabase()

  // Send a response based on success or failure
  if (result.rowsAffected == 1) {
    res.status(201).send({message: 'Success', id: newUuid})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Delete goal
app.delete('/goals/:id', async (req, res) => {
  // First delete from GoalComplete
  await client.execute({
    sql: `DELETE FROM GoalComplete WHERE goalId=?`,
    args: [req.params.id]
  })

  // Then delete from GoalTask
  await client.execute({
    sql: `DELETE FROM GoalTask WHERE goalId=?`,
    args: [req.params.id]
  })

  // Delete from database
  const result = await client.execute({
    sql: `DELETE FROM Goal WHERE id=?`,
    args: [req.params.id]
  })

  // Reload data from database for reading
  await loadGoalsFromDatabase()

  // Send a response
  if (result.rowsAffected == 1) {
    res.send({message: `Deleted goal with id ${req.params.id}`})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Update goalComplete
app.put('/goalcomplete/:id/:date', async (req, res) => {
  // Get the date we should be entering a record for, based on goal frequency
  const date = await getCompletionDate(new Date(req.params.date), req.params.id)

  // Check database to see if update or create
  let completeResult = await client.execute({
    sql: 'SELECT completed FROM goalComplete WHERE goalId=? AND date=?',
    args: [req.params.id, date]
  })
  
  // If an entry for the completion date doesn't exist, create a record
  let result
  if (completeResult.rows.length === 0) {
    result = await client.execute({
      sql: 'INSERT INTO goalComplete VALUES (?,?,?)',
      args: [
        req.params.id,
        date,
        req.body.completed
      ]
    })
  } else {
    // Else update the record
    result = await client.execute({
      sql: `UPDATE goalComplete
            SET completed=?
            WHERE goalId=?
            AND date=?`,
      args: [
        req.body.completed,
        req.params.id,
        date
      ]
    })
  }
  console.log(result)

  await loadGoalsFromDatabase()
  if (result.rowsAffected == 1) {
    res.send({message: 'Success', newCompleted: req.body.completed})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Read tasks associated with specified goal
app.get('/goals/:goalId/tasks', async (req, res) => {
  let result = await client.execute({
    sql: `SELECT id, title, date, description, completed, category
          FROM Task, GoalTask
          WHERE GoalTask.goalId = ? AND GoalTask.taskId = Task.id`,
    args: [req.params.goalId]
  })

  let resultArr = []
  // Format result
  for (let dataRow of result.rows) {
    let dataRowFormatted = {
      id: dataRow.id,
      title: dataRow.title,
      date: dataRow.date,
      description: dataRow.description,
      completed: dataRow.completed,
      category: dataRow.category.toString()
    }
    resultArr.push(dataRowFormatted)
  }

  res.send({tasks: resultArr})
})

// Update tasks associated with a specified goal
app.put('/goals/:goalId/tasks', async (req, res) => {
  let err = false
  let deletes = 0
  let inserts = 0

  // Get current rows
  const currResult = await client.execute({
    sql: 'SELECT * FROM GoalTask WHERE goalId = ?',
    args: [req.params.goalId]
  })

  // Go through current rows and delete any that aren't in the request
  for (let row of currResult.rows) {
    if (!req.body.taskIds.includes(row.taskId)) {
      const deleteResult = await client.execute({
        sql: 'DELETE FROM GoalTask WHERE taskId = ? AND goalId = ?',
        args: [row.taskId, req.params.goalId]
      })
      if (deleteResult.rowsAffected != 1) err = true
      else deletes++
    }
  }

  // Insert any that aren't already in the table
  for (let taskId of req.body.taskIds) {
    if (!currResult.rows.some((item) => item.taskId == taskId)) {
      const insertResult = await client.execute({
        sql: 'INSERT INTO GoalTask Values(?,?)',
        args: [req.params.goalId, taskId]
      })
      if (insertResult.rowsAffected != 1) err = true
      else inserts++
    }
  }

  // Send a response based on success or failure
  if (!err) {
    res.send({message: 'Success', inserts: inserts, deletes: deletes})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Read goals associated with specified task
app.get('/tasks/:taskId/goals', async (req, res) => {
  let result = await client.execute({
    sql: `SELECT id, title, description, frequency, quantity, category
          FROM Goal, GoalTask
          WHERE GoalTask.taskId = ? AND GoalTask.goalId = Goal.id`,
    args: [req.params.taskId]
  })

  let resultArr = []
  // Format result
  for (let dataRow of result.rows) {
    let dataRowFormatted = {
      id: dataRow.id,
      title: dataRow.title,
      description: dataRow.description,
      frequency: dataRow.frequency,
      quantity: dataRow.quantity,
      category: dataRow.category.toString()
    }
    resultArr.push(dataRowFormatted)
  }

  res.send({goals: resultArr})
})

// Update goals associated with a specified task
app.put('/tasks/:taskId/goals', async (req, res) => {
  let err = false
  let deletes = 0
  let inserts = 0

  // Get current rows
  const currResult = await client.execute({
    sql: 'SELECT * FROM GoalTask WHERE taskId = ?',
    args: [req.params.taskId]
  })

  // Go through current rows and delete any that aren't in the request
  for (let row of currResult.rows) {
    if (!req.body.goalIds.includes(row.goalId)) {
      const deleteResult = await client.execute({
        sql: 'DELETE FROM GoalTask WHERE goalId = ? AND taskId = ?',
        args: [row.goalId, req.params.taskId]
      })
      if (deleteResult.rowsAffected != 1) err = true
      else deletes++
    }
  }

  // Insert any that aren't already in the table
  for (let goalId of req.body.goalIds) {
    if (!currResult.rows.some((item) => item.goalId == goalId)) {
      const insertResult = await client.execute({
        sql: 'INSERT INTO GoalTask Values(?,?)',
        args: [goalId, req.params.taskId]
      })
      if (insertResult.rowsAffected != 1) err = true
      else inserts++
    }
  }

  // Send a response based on success or failure
  if (!err) {
    res.send({message: 'Success', inserts: inserts, deletes: deletes})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// List tasks
app.get('/tasks', async (req, res) => {
  if (req.query.listtype == 'date') { // grouped by date
    // If page param exists, send paginated data
    if (req.query.page) {
      // Remove the current and future tasks
      let oldestFirst = [...tasksByDate]
      let newestFirst = oldestFirst.reverse()
      let currFuture = []
      const todayStr = new Date().toDateString()
      const todayMs = new Date(todayStr).getTime()

      // Exit the loop if the list is empty
      while (newestFirst.length > 0) {
        // Get the milliseconds since epoch for the date
        let taskListDate = new Date(newestFirst[0][0])
        let taskListMs = taskListDate.getTime()

        // If it's a past date, we're done pulling items off the list
        if (taskListMs < todayMs) break

        // If it's today or a future date, pull it off the list
        currFuture.push(newestFirst.shift())
      }

      let end = false
      // If we're looking for only current and future events, send that
      // and send end = true if there are no more events to send
      if (req.query.page == '0') {
        if (newestFirst.length == 0) end = true
        res.send({tasks: currFuture.reverse(), end: end})
      } else {
        // If we're looking for a different page, calculate the offset
        const offset = (parseInt(req.query.page) - 1) * 5
        if (offset + 5 >= newestFirst.length) {
          end = true
        }

        // Get the set of events to send and add it to the current and future events
        const toSend = newestFirst.slice(0, offset + 5)
        const fullToSend = currFuture.concat(toSend)
        res.send({tasks: fullToSend.reverse(), end: end})
      }
      return
    }

    // If no page parameter was sent, send all data
    res.send({tasks: tasksByDate, end: true})
  } else if (req.query.listtype == 'category') { // grouped by category
    res.send({tasks: tasksByCategory, end: true})
  } else if (req.query.listtype == 'none') { // ungrouped
    if (req.query.date) {
      // Send a list of tasks for the specified date
      const response = await client.execute({
        sql: 'SELECT * FROM Task WHERE date=?',
        args: [req.query.date]
      })
    
      const formattedData = []
      for (let row of response.rows) {
        formattedData.push({
          id: row.id,
          title: row.title,
          date: row.date,
          description: row.description,
          completed: row.completed,
          category: row.category
        })
      }
    
      res.send({tasks: formattedData, end: true})
    } else {
      // Send an unsorted list of all tasks
      const result = await client.execute('SELECT * FROM Task')
    
      // Format result
      let resultArr = []
      for (let dataRow of result.rows) {
        let dataRowFormatted = {
          id: dataRow.id,
          title: dataRow.title,
          date: dataRow.date,
          description: dataRow.description,
          completed: dataRow.completed,
          category: dataRow.category.toString()
        }
        resultArr.push(dataRowFormatted)
      }
      res.send({tasks: resultArr, end: true})
    }
  } else {
    res.status(404).send({tasks: [], end: true, message: 'Invalid list type'})
  }
})

// Read one task
app.get('/tasks/:id', async (req, res) => {
  let response = await client.execute({
    sql: 'SELECT * FROM Task WHERE id=?',
    args: [req.params.id]
  })

  const row = response.rows[0]

  const formattedResponse = {
    id: row.id,
    title: row.title,
    date: row.date,
    description: row.description,
    completed: row.completed,
    category: row.category
  }

  res.send({task: formattedResponse})
})

// Update task
app.put('/tasks/:id', async (req, res) => {
  const result = await client.execute({
    sql: `UPDATE Task
          SET title=?, date=?, description=?, completed=?, category=?
          WHERE id=?`,
    args: [
      req.body.title,
      req.body.date,
      req.body.description,
      req.body.completed ? 1 : 0,
      req.body.category,
      req.params.id
    ]
  })
  await loadTasksFromDatabase()
  
  // Send a response based on success or failure
  if (result.rowsAffected == 1) {
    res.send({message: 'Success'})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Create task
app.post('/tasks', async (req, res) => {
  // Creat a UUID
  let newUuid = uuidv4()

  // Send to the database
  const result = await client.execute({
    sql: `INSERT INTO Task VALUES(?,?,?,?,?,?)`,
    args: [
      newUuid,
      req.body.title,
      req.body.date,
      req.body.description,
      req.body.completed,
      req.body.category
    ]
  })

  // Reload the data
  await loadTasksFromDatabase()

  // Send a response based on success or failure
  if (result.rowsAffected == 1) {
    res.status(201).send({message: 'Success', id: newUuid})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Delete task
app.delete('/tasks/:id', async (req, res) => {
  // First delete from GoalTask
  const goalTaskResult = await client.execute({
    sql: `DELETE FROM GoalTask WHERE taskId=?`,
    args: [req.params.id]
  })

  // Delete from database
  const result = await client.execute({
    sql: `DELETE FROM Task WHERE id=?`,
    args: [req.params.id]
  })

  // Reload data from database for reading
  await loadTasksFromDatabase()

  // Send a response
  if (result.rowsAffected == 1) {
    res.send({message: `Deleted task with id ${req.params.id}`})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// app.delete('*', async (req, res) => {
//   console.log('request body')
//   console.log(req.body)
//   console.log('request headers')
//   console.log(req.headers)
//   console.log(req.params)
//   res.status(404).send({message: 'Oops!'})
// })

// app.put('*', async (req, res) => {
//   console.log('request body')
//   console.log(req.body)
//   console.log('request headers')
//   console.log(req.headers)
//   console.log(req.params)
//   res.status(404).send({message: 'Oops!'})
// })

async function loadGoalsFromDatabase() {
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
    const today = new Date()
    const completionDate = await getCompletionDate(today, dataRowFormatted.id)
    let completeResult = await client.execute({
      sql: 'SELECT completed FROM goalComplete WHERE goalId=? AND date=?',
      args: [dataRowFormatted.id, completionDate]
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

async function loadTasksFromDatabase() {
  // Retrieve the tasks from the database
  let taskResult = await client.execute('SELECT * FROM Task')
  let categoryTemp = {}
  let dateTemp = {}
  let sortedData = []
  // let dataRowFormatted = {}
  function sortByDate(a, b) {
    let aDate = new Date(a.date)
    let bDate = new Date(b.date)
    return aDate.getTime() - bDate.getTime()
  }

  // Format and then sort by date
  for (let dataRow of taskResult.rows) {
    let dataRowFormatted = {
      id: dataRow.id,
      title: dataRow.title,
      date: dataRow.date,
      description: dataRow.description,
      completed: dataRow.completed == 1,
      category: dataRow.category.toString()
    }
    sortedData.push(dataRowFormatted)
  }
  sortedData.sort(sortByDate)
  
  // Put the results into an object sorted by category
  for (let dataRow of sortedData) {
    // Create an object to store tasks by category
    if (Object.hasOwn(categoryTemp, dataRow.category)) {
      categoryTemp[dataRow.category].push(dataRow)
    } else {
      categoryTemp[dataRow.category] = [dataRow]
    }

    // Create an object to store tasks by date
    if (Object.hasOwn(dateTemp, dataRow.date)) {
      dateTemp[dataRow.date].push(dataRow)
    } else {
      dateTemp[dataRow.date] = [dataRow]
    }
  }

  // Turn it into the list formats the client needs
  tasksByCategory = []
  for (const property in categoryTemp) {
    let categoryArr = []
    categoryArr.push(property)
    for (const dataItem of categoryTemp[property]) {
      categoryArr.push(dataItem)
    }
    tasksByCategory.push(categoryArr)
  }

  tasksByDate = []
  for (const property in dateTemp) {
    let dateArr = []
    dateArr.push(property)
    for (const dataItem of dateTemp[property]) {
      dateArr.push(dataItem)
    }
    tasksByDate.push(dateArr)
  }
}

app.listen(port, async () => {
  console.log('Loading data from database...')
  await loadGoalsFromDatabase()
  await loadTasksFromDatabase()

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